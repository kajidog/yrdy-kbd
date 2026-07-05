package main

import (
	"encoding/json"
	"errors"
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
	rooms *RoomStore
	mux   *http.ServeMux
}

func NewServer(cfg Config, kvs KVSClient, rooms *RoomStore) *Server {
	server := &Server{
		cfg:   cfg,
		kvs:   kvs,
		rooms: rooms,
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
	s.mux.HandleFunc("POST /api/rooms", s.handleCreateRoom)
	s.mux.HandleFunc("POST /api/rooms/{roomID}/publisher-session", s.handlePublisherSession)
	s.mux.HandleFunc("POST /api/rooms/{roomID}/viewer-session", s.handleViewerSession)
	s.mux.HandleFunc("POST /api/rooms/{roomID}/signaling-url", s.handleSignalingURL)
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
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		}
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

type createRoomRequest struct {
	Passphrase string `json:"passphrase"`
}

type createRoomResponse struct {
	RoomID     string `json:"roomId"`
	ChannelARN string `json:"channelArn"`
	PublishURL string `json:"publishUrl"`
	WatchURL   string `json:"watchUrl"`
}

func (s *Server) handleCreateRoom(w http.ResponseWriter, r *http.Request) {
	var req createRoomRequest
	if err := readJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}

	digest, err := newPassphraseDigest(req.Passphrase)
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}

	roomID, err := newRoomID()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}

	channelName := channelNameForRoom(roomID)
	channelARN, err := s.kvs.EnsureSignalingChannel(r.Context(), channelName)
	if err != nil {
		slog.Error("ensure signaling channel", "error", err)
		writeError(w, http.StatusBadGateway, fmt.Errorf("prepare KVS signaling channel"))
		return
	}

	room := Room{
		ID:          roomID,
		ChannelName: channelName,
		ChannelARN:  channelARN,
		CreatedAt:   time.Now().UTC(),
		passphrase:  digest,
	}
	s.rooms.Put(room)

	writeJSON(w, http.StatusCreated, createRoomResponse{
		RoomID:     room.ID,
		ChannelARN: room.ChannelARN,
		PublishURL: roomURL(s.cfg.PublisherOrigin, room.ID),
		WatchURL:   roomURL(s.cfg.ViewerOrigin, room.ID),
	})
}

type sessionRequest struct {
	Passphrase string `json:"passphrase"`
	ClientID   string `json:"clientId,omitempty"`
}

type sessionResponse struct {
	RoomID string `json:"roomId"`
	SessionConfig
}

func (s *Server) handlePublisherSession(w http.ResponseWriter, r *http.Request) {
	room, ok := s.requireRoom(w, r)
	if !ok {
		return
	}

	var req sessionRequest
	if err := readJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	if !room.passphrase.matches(req.Passphrase) {
		writeError(w, http.StatusForbidden, fmt.Errorf("passphrase does not match"))
		return
	}

	session, err := s.kvs.SessionConfig(r.Context(), SessionInput{
		ChannelARN: room.ChannelARN,
		Role:       RoleMaster,
	})
	if err != nil {
		slog.Error("create publisher session", "roomID", room.ID, "error", err)
		writeError(w, http.StatusBadGateway, fmt.Errorf("create KVS publisher session"))
		return
	}

	writeJSON(w, http.StatusOK, sessionResponse{RoomID: room.ID, SessionConfig: session})
}

func (s *Server) handleViewerSession(w http.ResponseWriter, r *http.Request) {
	room, ok := s.requireRoom(w, r)
	if !ok {
		return
	}

	var req sessionRequest
	if err := readJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	if !room.passphrase.matches(req.Passphrase) {
		writeError(w, http.StatusForbidden, fmt.Errorf("passphrase does not match"))
		return
	}
	if req.ClientID == "" {
		writeError(w, http.StatusBadRequest, fmt.Errorf("clientId is required"))
		return
	}

	session, err := s.kvs.SessionConfig(r.Context(), SessionInput{
		ChannelARN: room.ChannelARN,
		Role:       RoleViewer,
		ClientID:   req.ClientID,
	})
	if err != nil {
		slog.Error("create viewer session", "roomID", room.ID, "clientID", req.ClientID, "error", err)
		writeError(w, http.StatusBadGateway, fmt.Errorf("create KVS viewer session"))
		return
	}

	writeJSON(w, http.StatusOK, sessionResponse{RoomID: room.ID, SessionConfig: session})
}

type signalingURLRequest struct {
	Passphrase  string            `json:"passphrase"`
	Role        string            `json:"role"`
	ClientID    string            `json:"clientId,omitempty"`
	Endpoint    string            `json:"endpoint"`
	QueryParams map[string]string `json:"queryParams"`
}

type signalingURLResponse struct {
	SignedURL string `json:"signedUrl"`
}

func (s *Server) handleSignalingURL(w http.ResponseWriter, r *http.Request) {
	room, ok := s.requireRoom(w, r)
	if !ok {
		return
	}

	var req signalingURLRequest
	if err := readJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	if !room.passphrase.matches(req.Passphrase) {
		writeError(w, http.StatusForbidden, fmt.Errorf("passphrase does not match"))
		return
	}
	if err := validateSignalingURLRequest(room, req); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}

	signedURL, err := s.kvs.SignalingURL(r.Context(), SignalingURLInput{
		Endpoint:    req.Endpoint,
		QueryParams: req.QueryParams,
	})
	if err != nil {
		slog.Error("sign signaling URL", "roomID", room.ID, "error", err)
		writeError(w, http.StatusBadGateway, fmt.Errorf("sign KVS signaling URL"))
		return
	}

	writeJSON(w, http.StatusOK, signalingURLResponse{SignedURL: signedURL})
}

func validateSignalingURLRequest(room Room, req signalingURLRequest) error {
	role, err := parseRole(req.Role)
	if err != nil {
		return err
	}
	if req.Endpoint == "" {
		return fmt.Errorf("endpoint is required")
	}
	if req.QueryParams == nil {
		return fmt.Errorf("queryParams is required")
	}
	if req.QueryParams["X-Amz-ChannelARN"] != room.ChannelARN {
		return fmt.Errorf("queryParams X-Amz-ChannelARN does not match room")
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

func (s *Server) requireRoom(w http.ResponseWriter, r *http.Request) (Room, bool) {
	roomID := r.PathValue("roomID")
	if roomID == "" {
		writeError(w, http.StatusBadRequest, fmt.Errorf("roomID is required"))
		return Room{}, false
	}
	room, ok := s.rooms.Get(roomID)
	if !ok {
		writeError(w, http.StatusNotFound, fmt.Errorf("room not found"))
		return Room{}, false
	}
	return room, true
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

func roomURL(origin, roomID string) string {
	parsed, err := url.Parse(origin)
	if err != nil {
		return origin
	}
	query := parsed.Query()
	query.Set("roomId", roomID)
	parsed.RawQuery = query.Encode()
	return parsed.String()
}

func sameEndpoint(a, b string) bool {
	normalize := func(value string) string {
		return strings.TrimRight(value, "/")
	}
	return normalize(a) == normalize(b)
}

var errEndpointMismatch = errors.New("endpoint does not match session")
