package main

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"net/url"
	"strings"
	"time"
)

type Server struct {
	cfg   Config
	kvs   KVSClient
	lives *LiveStore
	mux   *http.ServeMux
}

func NewServer(cfg Config, kvs KVSClient, lives *LiveStore) *Server {
	server := &Server{
		cfg:   cfg,
		kvs:   kvs,
		lives: lives,
		mux:   http.NewServeMux(),
	}
	server.routes()
	return server
}

func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	s.withCORS(s.mux).ServeHTTP(w, r)
}

func (s *Server) routes() {
	s.mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	})
	s.mux.HandleFunc("GET /api/me", s.authed(s.handleMe))
	s.mux.HandleFunc("POST /api/lives", s.authed(s.handleCreateLive))
	s.mux.HandleFunc("GET /api/lives", s.authed(s.handleSearchLives))
	s.mux.HandleFunc("GET /api/me/lives", s.authed(s.handleMyLives))
	s.mux.HandleFunc("GET /api/lives/{liveID}", s.authed(s.handleGetLive))
	s.mux.HandleFunc("POST /api/lives/{liveID}/publisher-session", s.authed(s.handlePublisherSession))
	s.mux.HandleFunc("POST /api/lives/{liveID}/storage-session", s.authed(s.handleStorageSession))
	s.mux.HandleFunc("POST /api/lives/{liveID}/stop", s.authed(s.handleStopLive))
	s.mux.HandleFunc("POST /api/lives/{liveID}/viewer-session", s.authed(s.handleViewerSession))
	s.mux.HandleFunc("POST /api/lives/{liveID}/playback", s.authed(s.handlePlayback))
	s.mux.HandleFunc("POST /api/lives/{liveID}/signaling-url", s.authed(s.handleSignalingURL))
}

func (s *Server) authed(handler func(http.ResponseWriter, *http.Request, User)) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		user, err := userFromRequest(r)
		if err != nil {
			writeError(w, http.StatusUnauthorized, err)
			return
		}
		handler(w, r, user)
	}
}

func (s *Server) withCORS(next http.Handler) http.Handler {
	allowed := map[string]bool{
		s.cfg.PublisherOrigin: true,
		s.cfg.ViewerOrigin:    true,
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if origin := r.Header.Get("Origin"); allowed[origin] {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Vary", "Origin")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		}
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

type liveResponse struct {
	ID              string     `json:"id"`
	Title           string     `json:"title"`
	OwnerName       string     `json:"ownerName"`
	Public          bool       `json:"public"`
	Record          bool       `json:"record"`
	Status          LiveStatus `json:"status"`
	HasPassphrase   bool       `json:"hasPassphrase"`
	HasRecording    bool       `json:"hasRecording"`
	Owned           bool       `json:"owned"`
	CreatedAt       time.Time  `json:"createdAt"`
	StartedAt       *time.Time `json:"startedAt,omitempty"`
	EndedAt         *time.Time `json:"endedAt,omitempty"`
	DurationSeconds int64      `json:"durationSeconds,omitempty"`
	WatchURL        string     `json:"watchUrl"`
}

func (s *Server) liveResponse(live Live, viewer User) liveResponse {
	var duration int64
	if live.StartedAt != nil {
		end := time.Now().UTC()
		if live.EndedAt != nil {
			end = *live.EndedAt
		}
		duration = int64(end.Sub(*live.StartedAt).Seconds())
	}
	return liveResponse{
		ID:              live.ID,
		Title:           live.Title,
		OwnerName:       live.OwnerName,
		Public:          live.Public,
		Record:          live.Record,
		Status:          live.Status,
		HasPassphrase:   live.hasPassphrase(),
		HasRecording:    live.hasRecording(),
		Owned:           live.OwnerID == viewer.ID,
		CreatedAt:       live.CreatedAt,
		StartedAt:       live.StartedAt,
		EndedAt:         live.EndedAt,
		DurationSeconds: duration,
		WatchURL:        watchURL(s.cfg.ViewerOrigin, live.ID),
	}
}

func (s *Server) handleMe(w http.ResponseWriter, r *http.Request, user User) {
	writeJSON(w, http.StatusOK, map[string]string{"userId": user.ID, "username": user.Name})
}

type createLiveRequest struct {
	Title      string `json:"title"`
	Passphrase string `json:"passphrase,omitempty"`
	Public     bool   `json:"public"`
	Record     bool   `json:"record"`
}

func (s *Server) handleCreateLive(w http.ResponseWriter, r *http.Request, user User) {
	var req createLiveRequest
	if err := readJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}

	title := strings.TrimSpace(req.Title)
	if title == "" {
		writeError(w, http.StatusBadRequest, fmt.Errorf("title is required"))
		return
	}
	if len([]rune(title)) > 120 {
		writeError(w, http.StatusBadRequest, fmt.Errorf("title must be 120 characters or less"))
		return
	}

	digest, err := newPassphraseDigest(req.Passphrase)
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}

	liveID, err := newLiveID()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}

	channelName := channelNameForLive(liveID)
	channelARN, err := s.kvs.EnsureSignalingChannel(r.Context(), channelName)
	if err != nil {
		slog.Error("ensure signaling channel", "error", err)
		writeError(w, http.StatusBadGateway, fmt.Errorf("prepare KVS signaling channel"))
		return
	}

	var streamARN string
	if req.Record {
		streamARN, err = s.kvs.EnsureStream(r.Context(), streamNameForLive(liveID))
		if err != nil {
			slog.Error("ensure stream", "error", err)
			writeError(w, http.StatusBadGateway, fmt.Errorf("prepare KVS stream for recording"))
			return
		}
		if err := s.kvs.ConfigureMediaStorage(r.Context(), channelARN, streamARN); err != nil {
			slog.Error("configure media storage", "error", err)
			writeError(w, http.StatusBadGateway, fmt.Errorf("enable KVS media storage"))
			return
		}
	}

	live := Live{
		ID:          liveID,
		OwnerID:     user.ID,
		OwnerName:   user.Name,
		Title:       title,
		Public:      req.Public,
		Record:      req.Record,
		Status:      LiveStatusCreated,
		ChannelName: channelName,
		ChannelARN:  channelARN,
		StreamARN:   streamARN,
		CreatedAt:   time.Now().UTC(),
		passphrase:  digest,
	}
	if err := s.lives.Put(live); err != nil {
		slog.Error("persist live", "liveID", live.ID, "error", err)
		writeError(w, http.StatusInternalServerError, fmt.Errorf("persist live"))
		return
	}

	writeJSON(w, http.StatusCreated, s.liveResponse(live, user))
}

func (s *Server) handleSearchLives(w http.ResponseWriter, r *http.Request, user User) {
	query := r.URL.Query().Get("q")
	lives := s.lives.SearchPublic(query)
	responses := make([]liveResponse, 0, len(lives))
	for _, live := range lives {
		responses = append(responses, s.liveResponse(live, user))
	}
	writeJSON(w, http.StatusOK, map[string]any{"lives": responses})
}

func (s *Server) handleMyLives(w http.ResponseWriter, r *http.Request, user User) {
	lives := s.lives.ListByOwner(user.ID)
	responses := make([]liveResponse, 0, len(lives))
	for _, live := range lives {
		responses = append(responses, s.liveResponse(live, user))
	}
	writeJSON(w, http.StatusOK, map[string]any{"lives": responses})
}

func (s *Server) handleGetLive(w http.ResponseWriter, r *http.Request, user User) {
	live, ok := s.requireLive(w, r)
	if !ok {
		return
	}
	writeJSON(w, http.StatusOK, s.liveResponse(live, user))
}

type sessionResponse struct {
	LiveID string `json:"liveId"`
	SessionConfig
}

func (s *Server) handlePublisherSession(w http.ResponseWriter, r *http.Request, user User) {
	live, ok := s.requireLive(w, r)
	if !ok {
		return
	}
	if live.OwnerID != user.ID {
		writeError(w, http.StatusForbidden, fmt.Errorf("only the owner can broadcast this live"))
		return
	}
	if live.Status == LiveStatusEnded {
		writeError(w, http.StatusConflict, fmt.Errorf("ended lives cannot be restarted"))
		return
	}

	session, err := s.kvs.SessionConfig(r.Context(), SessionInput{
		ChannelARN: live.ChannelARN,
		Role:       RoleMaster,
	})
	if err != nil {
		slog.Error("create publisher session", "liveID", live.ID, "error", err)
		writeError(w, http.StatusBadGateway, fmt.Errorf("create KVS publisher session"))
		return
	}

	live, err = s.lives.Update(live.ID, func(l *Live) {
		l.Status = LiveStatusLive
		if l.StartedAt == nil {
			now := time.Now().UTC()
			l.StartedAt = &now
		}
		l.EndedAt = nil
	})
	if err != nil {
		slog.Error("mark live started", "liveID", live.ID, "error", err)
		writeError(w, http.StatusInternalServerError, fmt.Errorf("update live state"))
		return
	}

	writeJSON(w, http.StatusOK, sessionResponse{LiveID: live.ID, SessionConfig: session})
}

func (s *Server) handleStorageSession(w http.ResponseWriter, r *http.Request, user User) {
	live, ok := s.requireLive(w, r)
	if !ok {
		return
	}
	if live.OwnerID != user.ID {
		writeError(w, http.StatusForbidden, fmt.Errorf("only the owner can start recording"))
		return
	}
	if !live.Record {
		writeError(w, http.StatusBadRequest, fmt.Errorf("recording is not enabled for this live"))
		return
	}

	if err := s.kvs.JoinStorageSession(r.Context(), live.ChannelARN); err != nil {
		slog.Error("join storage session", "liveID", live.ID, "error", err)
		writeError(w, http.StatusBadGateway, fmt.Errorf("start KVS recording session"))
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "recording"})
}

func (s *Server) handleStopLive(w http.ResponseWriter, r *http.Request, user User) {
	live, ok := s.requireLive(w, r)
	if !ok {
		return
	}
	if live.OwnerID != user.ID {
		writeError(w, http.StatusForbidden, fmt.Errorf("only the owner can stop this live"))
		return
	}

	live, err := s.lives.Update(live.ID, func(l *Live) {
		if l.Status != LiveStatusLive {
			return
		}
		l.Status = LiveStatusEnded
		now := time.Now().UTC()
		l.EndedAt = &now
	})
	if err != nil {
		slog.Error("mark live ended", "liveID", live.ID, "error", err)
		writeError(w, http.StatusInternalServerError, fmt.Errorf("update live state"))
		return
	}
	writeJSON(w, http.StatusOK, s.liveResponse(live, user))
}

type viewerSessionRequest struct {
	Passphrase string `json:"passphrase,omitempty"`
	ClientID   string `json:"clientId"`
}

func (s *Server) handleViewerSession(w http.ResponseWriter, r *http.Request, user User) {
	live, ok := s.requireLive(w, r)
	if !ok {
		return
	}

	var req viewerSessionRequest
	if err := readJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	if live.Status != LiveStatusLive {
		writeError(w, http.StatusConflict, fmt.Errorf("live is not broadcasting"))
		return
	}
	if !live.watchableBy(user, req.Passphrase) {
		writeError(w, http.StatusForbidden, fmt.Errorf("passphrase does not match"))
		return
	}
	if req.ClientID == "" {
		writeError(w, http.StatusBadRequest, fmt.Errorf("clientId is required"))
		return
	}

	session, err := s.kvs.SessionConfig(r.Context(), SessionInput{
		ChannelARN: live.ChannelARN,
		Role:       RoleViewer,
		ClientID:   req.ClientID,
	})
	if err != nil {
		slog.Error("create viewer session", "liveID", live.ID, "clientID", req.ClientID, "error", err)
		writeError(w, http.StatusBadGateway, fmt.Errorf("create KVS viewer session"))
		return
	}

	writeJSON(w, http.StatusOK, sessionResponse{LiveID: live.ID, SessionConfig: session})
}

type playbackRequest struct {
	Passphrase string `json:"passphrase,omitempty"`
}

type playbackResponse struct {
	LiveID          string     `json:"liveId"`
	HLSURL          string     `json:"hlsUrl"`
	PlaybackMode    string     `json:"playbackMode"`
	StartedAt       *time.Time `json:"startedAt,omitempty"`
	EndedAt         *time.Time `json:"endedAt,omitempty"`
	DurationSeconds int64      `json:"durationSeconds,omitempty"`
}

func (s *Server) handlePlayback(w http.ResponseWriter, r *http.Request, user User) {
	live, ok := s.requireLive(w, r)
	if !ok {
		return
	}

	var req playbackRequest
	if err := readJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	if !live.watchableBy(user, req.Passphrase) {
		writeError(w, http.StatusForbidden, fmt.Errorf("passphrase does not match"))
		return
	}
	if !live.hasRecording() {
		writeError(w, http.StatusConflict, fmt.Errorf("this live has no recording"))
		return
	}

	isLive := live.Status == LiveStatusLive
	end := time.Now().UTC()
	if live.EndedAt != nil {
		end = *live.EndedAt
	}
	hlsURL, err := s.kvs.HLSPlaybackURL(r.Context(), HLSPlaybackInput{
		StreamARN: live.StreamARN,
		Live:      isLive,
		Start:     *live.StartedAt,
		End:       end,
	})
	if err != nil {
		slog.Error("create HLS playback URL", "liveID", live.ID, "error", err)
		writeError(w, http.StatusBadGateway, fmt.Errorf("create HLS playback URL"))
		return
	}

	mode := "ON_DEMAND"
	if isLive {
		mode = "LIVE"
	}
	writeJSON(w, http.StatusOK, playbackResponse{
		LiveID:          live.ID,
		HLSURL:          hlsURL,
		PlaybackMode:    mode,
		StartedAt:       live.StartedAt,
		EndedAt:         live.EndedAt,
		DurationSeconds: int64(end.Sub(*live.StartedAt).Seconds()),
	})
}

type signalingURLRequest struct {
	Passphrase  string            `json:"passphrase,omitempty"`
	Role        string            `json:"role"`
	ClientID    string            `json:"clientId,omitempty"`
	Endpoint    string            `json:"endpoint"`
	QueryParams map[string]string `json:"queryParams"`
}

type signalingURLResponse struct {
	SignedURL string `json:"signedUrl"`
}

func (s *Server) handleSignalingURL(w http.ResponseWriter, r *http.Request, user User) {
	live, ok := s.requireLive(w, r)
	if !ok {
		return
	}

	var req signalingURLRequest
	if err := readJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}

	role, err := parseRole(req.Role)
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	switch role {
	case RoleMaster:
		if live.OwnerID != user.ID {
			writeError(w, http.StatusForbidden, fmt.Errorf("only the owner can sign master URLs"))
			return
		}
	case RoleViewer:
		if !live.watchableBy(user, req.Passphrase) {
			writeError(w, http.StatusForbidden, fmt.Errorf("passphrase does not match"))
			return
		}
	}

	if err := validateSignalingURLRequest(live, role, req); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}

	signedURL, err := s.kvs.SignalingURL(r.Context(), SignalingURLInput{
		Endpoint:    req.Endpoint,
		QueryParams: req.QueryParams,
	})
	if err != nil {
		slog.Error("sign signaling URL", "liveID", live.ID, "error", err)
		writeError(w, http.StatusBadGateway, fmt.Errorf("sign KVS signaling URL"))
		return
	}

	writeJSON(w, http.StatusOK, signalingURLResponse{SignedURL: signedURL})
}

func validateSignalingURLRequest(live Live, role Role, req signalingURLRequest) error {
	if req.Endpoint == "" {
		return fmt.Errorf("endpoint is required")
	}
	if req.QueryParams == nil {
		return fmt.Errorf("queryParams is required")
	}
	if req.QueryParams["X-Amz-ChannelARN"] != live.ChannelARN {
		return fmt.Errorf("queryParams X-Amz-ChannelARN does not match live")
	}
	switch role {
	case RoleMaster:
		if req.ClientID != "" || req.QueryParams["X-Amz-ClientId"] != "" {
			return fmt.Errorf("master requests must not include clientId")
		}
	case RoleViewer:
		if req.ClientID == "" {
			return fmt.Errorf("clientId is required for viewer")
		}
		if req.QueryParams["X-Amz-ClientId"] != req.ClientID {
			return fmt.Errorf("queryParams X-Amz-ClientId does not match clientId")
		}
	}
	return nil
}

func (s *Server) requireLive(w http.ResponseWriter, r *http.Request) (Live, bool) {
	liveID := r.PathValue("liveID")
	if liveID == "" {
		writeError(w, http.StatusBadRequest, fmt.Errorf("liveID is required"))
		return Live{}, false
	}
	live, ok := s.lives.Get(liveID)
	if !ok {
		writeError(w, http.StatusNotFound, fmt.Errorf("live not found"))
		return Live{}, false
	}
	return live, true
}

func readJSON(r *http.Request, out any) error {
	defer r.Body.Close()
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(out); err != nil {
		return fmt.Errorf("invalid JSON: %w", err)
	}
	return nil
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(value); err != nil {
		slog.Error("write JSON response", "error", err)
	}
}

func writeError(w http.ResponseWriter, status int, err error) {
	writeJSON(w, status, map[string]string{"error": err.Error()})
}

func watchURL(origin, liveID string) string {
	parsed, err := url.Parse(origin)
	if err != nil {
		return origin
	}
	query := parsed.Query()
	query.Set("liveId", liveID)
	parsed.RawQuery = query.Encode()
	return parsed.String()
}
