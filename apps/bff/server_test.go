package main

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

type fakeKVSClient struct {
	channelARN string
	streamARN  string
	session    SessionConfig
	signedURL  string
	hlsURL     string

	ensuredChannelName string
	ensuredStreamName  string
	storageChannelARN  string
	joinedChannelARN   string
	lastSessionInput   SessionInput
	lastSignInput      SignalingURLInput
	lastHLSInput       HLSPlaybackInput
	sessionConfigCalls int
}

func (f *fakeKVSClient) EnsureSignalingChannel(_ context.Context, channelName string) (string, error) {
	f.ensuredChannelName = channelName
	return f.channelARN, nil
}

func (f *fakeKVSClient) SessionConfig(_ context.Context, input SessionInput) (SessionConfig, error) {
	f.sessionConfigCalls++
	f.lastSessionInput = input
	session := f.session
	session.Role = input.Role
	session.ChannelARN = input.ChannelARN
	return session, nil
}

func (f *fakeKVSClient) SignalingURL(_ context.Context, input SignalingURLInput) (string, error) {
	f.lastSignInput = input
	return f.signedURL, nil
}

func (f *fakeKVSClient) EnsureStream(_ context.Context, streamName string) (string, error) {
	f.ensuredStreamName = streamName
	return f.streamARN, nil
}

func (f *fakeKVSClient) ConfigureMediaStorage(_ context.Context, channelARN, _ string) error {
	f.storageChannelARN = channelARN
	return nil
}

func (f *fakeKVSClient) JoinStorageSession(_ context.Context, channelARN string) error {
	f.joinedChannelARN = channelARN
	return nil
}

func (f *fakeKVSClient) HLSPlaybackURL(_ context.Context, input HLSPlaybackInput) (string, error) {
	f.lastHLSInput = input
	return f.hlsURL, nil
}

func newTestServer(t *testing.T) (*Server, *fakeKVSClient) {
	t.Helper()
	kvs := &fakeKVSClient{
		channelARN: "arn:aws:kinesisvideo:ap-northeast-1:123456789012:channel/yrdy-kbd-test/1",
		streamARN:  "arn:aws:kinesisvideo:ap-northeast-1:123456789012:stream/yrdy-kbd-test/1",
		signedURL:  "wss://signed.example.test",
		hlsURL:     "https://hls.example.test/session.m3u8",
		session: SessionConfig{
			Region: "ap-northeast-1",
			Endpoints: EndpointSet{
				WSS:   "wss://v-test.kinesisvideo.ap-northeast-1.amazonaws.com",
				HTTPS: "https://v-test.kinesisvideo.ap-northeast-1.amazonaws.com",
			},
			ICEServers: []ICEServer{{URLs: []string{"stun:stun.kinesisvideo.ap-northeast-1.amazonaws.com:443"}}},
		},
	}
	cfg := Config{
		Addr:            ":0",
		Region:          "ap-northeast-1",
		PublisherOrigin: "http://publisher.test",
		ViewerOrigin:    "http://viewer.test",
	}
	lives, err := NewLiveStore("")
	if err != nil {
		t.Fatalf("new live store: %v", err)
	}
	return NewServer(cfg, kvs, lives), kvs
}

func bearerToken(t *testing.T, sub, username string) string {
	t.Helper()
	payload, err := json.Marshal(map[string]string{
		"sub":              sub,
		"cognito:username": username,
	})
	if err != nil {
		t.Fatalf("marshal claims: %v", err)
	}
	segment := base64.RawURLEncoding.EncodeToString
	return segment([]byte(`{"alg":"RS256","typ":"JWT"}`)) + "." + segment(payload) + "." + segment([]byte("sig"))
}

var (
	ownerToken  = ""
	viewerToken = ""
)

func tokens(t *testing.T) (owner, viewer string) {
	if ownerToken == "" {
		ownerToken = bearerToken(t, "owner-sub", "alice")
		viewerToken = bearerToken(t, "viewer-sub", "bob")
	}
	return ownerToken, viewerToken
}

func createTestLive(t *testing.T, server *Server, token string, body map[string]any) liveResponse {
	t.Helper()
	return requestJSONAs[liveResponse](t, server, http.MethodPost, "/api/lives", token, body, http.StatusCreated)
}

func TestRequestsWithoutTokenAreRejected(t *testing.T) {
	server, _ := newTestServer(t)
	requestJSONAs[map[string]string](t, server, http.MethodPost, "/api/lives", "", map[string]any{
		"title": "no auth",
	}, http.StatusUnauthorized)
}

func TestCreateLiveAndPublisherSession(t *testing.T) {
	server, kvs := newTestServer(t)
	owner, _ := tokens(t)

	created := createTestLive(t, server, owner, map[string]any{
		"title":      "morning stream",
		"passphrase": "open-sesame",
		"public":     true,
		"record":     true,
	})

	if created.ID == "" {
		t.Fatal("expected live id")
	}
	if !created.HasPassphrase || !created.Record || !created.Public {
		t.Fatalf("unexpected live flags: %+v", created)
	}
	if created.OwnerName != "alice" {
		t.Fatalf("owner name = %q, want alice", created.OwnerName)
	}
	if got, want := kvs.ensuredChannelName, channelNameForLive(created.ID); got != want {
		t.Fatalf("ensured channel name = %q, want %q", got, want)
	}
	if got, want := kvs.ensuredStreamName, streamNameForLive(created.ID); got != want {
		t.Fatalf("ensured stream name = %q, want %q", got, want)
	}
	if kvs.storageChannelARN != kvs.channelARN {
		t.Fatalf("media storage configured for %q, want %q", kvs.storageChannelARN, kvs.channelARN)
	}
	if created.WatchURL != "http://viewer.test?liveId="+created.ID {
		t.Fatalf("unexpected watch URL: %s", created.WatchURL)
	}
	if created.Status != LiveStatusCreated {
		t.Fatalf("status = %q, want created", created.Status)
	}

	session := requestJSONAs[sessionResponse](t, server, http.MethodPost, "/api/lives/"+created.ID+"/publisher-session", owner, map[string]any{}, http.StatusOK)
	if session.Role != RoleMaster {
		t.Fatalf("session role = %q, want MASTER", session.Role)
	}

	live := requestJSONAs[liveResponse](t, server, http.MethodGet, "/api/lives/"+created.ID, owner, nil, http.StatusOK)
	if live.Status != LiveStatusLive {
		t.Fatalf("status after publisher session = %q, want live", live.Status)
	}
	if live.StartedAt == nil {
		t.Fatal("expected startedAt to be set")
	}
}

func TestPublisherSessionRequiresOwner(t *testing.T) {
	server, _ := newTestServer(t)
	owner, viewer := tokens(t)
	created := createTestLive(t, server, owner, map[string]any{"title": "owner only", "public": true})

	requestJSONAs[map[string]string](t, server, http.MethodPost, "/api/lives/"+created.ID+"/publisher-session", viewer, map[string]any{}, http.StatusForbidden)
}

func TestPublisherSessionRejectsEndedLive(t *testing.T) {
	server, kvs := newTestServer(t)
	owner, _ := tokens(t)
	created := createTestLive(t, server, owner, map[string]any{
		"title":  "recorded once",
		"public": true,
		"record": true,
	})

	requestJSONAs[sessionResponse](t, server, http.MethodPost, "/api/lives/"+created.ID+"/publisher-session", owner, map[string]any{}, http.StatusOK)
	stopped := requestJSONAs[liveResponse](t, server, http.MethodPost, "/api/lives/"+created.ID+"/stop", owner, map[string]any{}, http.StatusOK)
	if stopped.EndedAt == nil {
		t.Fatal("expected stopped live to have endedAt")
	}

	callsBefore := kvs.sessionConfigCalls
	requestJSONAs[map[string]string](t, server, http.MethodPost, "/api/lives/"+created.ID+"/publisher-session", owner, map[string]any{}, http.StatusConflict)
	if kvs.sessionConfigCalls != callsBefore {
		t.Fatalf("SessionConfig calls = %d, want %d", kvs.sessionConfigCalls, callsBefore)
	}

	live := requestJSONAs[liveResponse](t, server, http.MethodGet, "/api/lives/"+created.ID, owner, nil, http.StatusOK)
	if live.Status != LiveStatusEnded {
		t.Fatalf("status after rejected publisher session = %q, want ended", live.Status)
	}
	if live.EndedAt == nil {
		t.Fatal("expected endedAt to remain set")
	}
}

func TestViewerSessionPassphraseAndStatus(t *testing.T) {
	server, _ := newTestServer(t)
	owner, viewer := tokens(t)
	created := createTestLive(t, server, owner, map[string]any{
		"title":      "guarded",
		"passphrase": "correct",
		"public":     false,
	})

	// Not broadcasting yet.
	requestJSONAs[map[string]string](t, server, http.MethodPost, "/api/lives/"+created.ID+"/viewer-session", viewer, map[string]any{
		"passphrase": "correct",
		"clientId":   "viewer-1",
	}, http.StatusConflict)

	requestJSONAs[sessionResponse](t, server, http.MethodPost, "/api/lives/"+created.ID+"/publisher-session", owner, map[string]any{}, http.StatusOK)

	requestJSONAs[map[string]string](t, server, http.MethodPost, "/api/lives/"+created.ID+"/viewer-session", viewer, map[string]any{
		"passphrase": "wrong",
		"clientId":   "viewer-1",
	}, http.StatusForbidden)

	requestJSONAs[map[string]string](t, server, http.MethodPost, "/api/lives/"+created.ID+"/viewer-session", viewer, map[string]any{
		"passphrase": "correct",
	}, http.StatusBadRequest)

	session := requestJSONAs[sessionResponse](t, server, http.MethodPost, "/api/lives/"+created.ID+"/viewer-session", viewer, map[string]any{
		"passphrase": "correct",
		"clientId":   "viewer-1",
	}, http.StatusOK)
	if session.Role != RoleViewer {
		t.Fatalf("session role = %q, want VIEWER", session.Role)
	}
}

func TestLiveWithoutPassphraseIsOpen(t *testing.T) {
	server, _ := newTestServer(t)
	owner, viewer := tokens(t)
	created := createTestLive(t, server, owner, map[string]any{"title": "open live", "public": true})
	if created.HasPassphrase {
		t.Fatal("expected no passphrase")
	}

	requestJSONAs[sessionResponse](t, server, http.MethodPost, "/api/lives/"+created.ID+"/publisher-session", owner, map[string]any{}, http.StatusOK)
	requestJSONAs[sessionResponse](t, server, http.MethodPost, "/api/lives/"+created.ID+"/viewer-session", viewer, map[string]any{
		"clientId": "viewer-1",
	}, http.StatusOK)
}

func TestSearchListsPublicLivesOnly(t *testing.T) {
	server, _ := newTestServer(t)
	owner, viewer := tokens(t)

	public := createTestLive(t, server, owner, map[string]any{"title": "public gaming", "public": true})
	private := createTestLive(t, server, owner, map[string]any{"title": "secret meeting", "public": false})
	requestJSONAs[sessionResponse](t, server, http.MethodPost, "/api/lives/"+public.ID+"/publisher-session", owner, map[string]any{}, http.StatusOK)
	requestJSONAs[sessionResponse](t, server, http.MethodPost, "/api/lives/"+private.ID+"/publisher-session", owner, map[string]any{}, http.StatusOK)

	type liveList struct {
		Lives []liveResponse `json:"lives"`
	}

	all := requestJSONAs[liveList](t, server, http.MethodGet, "/api/lives", viewer, nil, http.StatusOK)
	if len(all.Lives) != 1 || all.Lives[0].ID != public.ID {
		t.Fatalf("search should list only the public live, got %+v", all.Lives)
	}

	byTitle := requestJSONAs[liveList](t, server, http.MethodGet, "/api/lives?q=gaming", viewer, nil, http.StatusOK)
	if len(byTitle.Lives) != 1 {
		t.Fatalf("expected title match, got %+v", byTitle.Lives)
	}

	byOwner := requestJSONAs[liveList](t, server, http.MethodGet, "/api/lives?q=ALICE", viewer, nil, http.StatusOK)
	if len(byOwner.Lives) != 1 {
		t.Fatalf("expected owner-name match, got %+v", byOwner.Lives)
	}

	none := requestJSONAs[liveList](t, server, http.MethodGet, "/api/lives?q=nothing", viewer, nil, http.StatusOK)
	if len(none.Lives) != 0 {
		t.Fatalf("expected no match, got %+v", none.Lives)
	}

	mine := requestJSONAs[liveList](t, server, http.MethodGet, "/api/me/lives", owner, nil, http.StatusOK)
	if len(mine.Lives) != 2 {
		t.Fatalf("owner should see both lives, got %d", len(mine.Lives))
	}
}

func TestPlaybackForRecordedLive(t *testing.T) {
	server, kvs := newTestServer(t)
	owner, viewer := tokens(t)
	created := createTestLive(t, server, owner, map[string]any{
		"title":  "recorded live",
		"public": true,
		"record": true,
	})

	// No recording before the broadcast started.
	requestJSONAs[map[string]string](t, server, http.MethodPost, "/api/lives/"+created.ID+"/playback", viewer, map[string]any{}, http.StatusConflict)

	requestJSONAs[sessionResponse](t, server, http.MethodPost, "/api/lives/"+created.ID+"/publisher-session", owner, map[string]any{}, http.StatusOK)

	requestJSONAs[map[string]string](t, server, http.MethodPost, "/api/lives/"+created.ID+"/storage-session", owner, map[string]any{}, http.StatusOK)
	if kvs.joinedChannelARN != kvs.channelARN {
		t.Fatalf("storage session joined %q, want %q", kvs.joinedChannelARN, kvs.channelARN)
	}

	// While live, playback uses LIVE mode.
	livePlayback := requestJSONAs[playbackResponse](t, server, http.MethodPost, "/api/lives/"+created.ID+"/playback", viewer, map[string]any{}, http.StatusOK)
	if livePlayback.PlaybackMode != "LIVE" || !kvs.lastHLSInput.Live {
		t.Fatalf("expected LIVE playback, got %+v", livePlayback)
	}

	requestJSONAs[liveResponse](t, server, http.MethodPost, "/api/lives/"+created.ID+"/stop", owner, map[string]any{}, http.StatusOK)

	playback := requestJSONAs[playbackResponse](t, server, http.MethodPost, "/api/lives/"+created.ID+"/playback", viewer, map[string]any{}, http.StatusOK)
	if playback.PlaybackMode != "ON_DEMAND" || kvs.lastHLSInput.Live {
		t.Fatalf("expected ON_DEMAND playback, got %+v", playback)
	}
	if playback.HLSURL != kvs.hlsURL {
		t.Fatalf("hls url = %q, want %q", playback.HLSURL, kvs.hlsURL)
	}
	if kvs.lastHLSInput.StreamARN != kvs.streamARN {
		t.Fatalf("hls stream arn = %q, want %q", kvs.lastHLSInput.StreamARN, kvs.streamARN)
	}
	if playback.StartedAt == nil || playback.EndedAt == nil {
		t.Fatalf("expected playback range, got %+v", playback)
	}
}

func TestStorageSessionRequiresRecordingEnabled(t *testing.T) {
	server, _ := newTestServer(t)
	owner, _ := tokens(t)
	created := createTestLive(t, server, owner, map[string]any{"title": "no recording", "public": true})

	requestJSONAs[map[string]string](t, server, http.MethodPost, "/api/lives/"+created.ID+"/storage-session", owner, map[string]any{}, http.StatusBadRequest)
}

func TestSignalingURLValidation(t *testing.T) {
	server, kvs := newTestServer(t)
	owner, viewer := tokens(t)
	created := createTestLive(t, server, owner, map[string]any{
		"title":      "signal",
		"passphrase": "correct",
		"public":     true,
	})
	requestJSONAs[sessionResponse](t, server, http.MethodPost, "/api/lives/"+created.ID+"/publisher-session", owner, map[string]any{}, http.StatusOK)

	res := requestJSONAs[signalingURLResponse](t, server, http.MethodPost, "/api/lives/"+created.ID+"/signaling-url", viewer, signalingURLRequest{
		Passphrase: "correct",
		Role:       string(RoleViewer),
		ClientID:   "viewer-1",
		Endpoint:   "wss://v-test.kinesisvideo.ap-northeast-1.amazonaws.com",
		QueryParams: map[string]string{
			"X-Amz-ChannelARN": kvs.channelARN,
			"X-Amz-ClientId":   "viewer-1",
		},
	}, http.StatusOK)
	if res.SignedURL != kvs.signedURL {
		t.Fatalf("signed URL = %q, want %q", res.SignedURL, kvs.signedURL)
	}

	// Mismatched client id in query params.
	requestJSONAs[map[string]string](t, server, http.MethodPost, "/api/lives/"+created.ID+"/signaling-url", viewer, signalingURLRequest{
		Passphrase: "correct",
		Role:       string(RoleViewer),
		ClientID:   "viewer-1",
		Endpoint:   "wss://v-test.kinesisvideo.ap-northeast-1.amazonaws.com",
		QueryParams: map[string]string{
			"X-Amz-ChannelARN": kvs.channelARN,
			"X-Amz-ClientId":   "viewer-2",
		},
	}, http.StatusBadRequest)

	// Only the owner may sign MASTER URLs.
	requestJSONAs[map[string]string](t, server, http.MethodPost, "/api/lives/"+created.ID+"/signaling-url", viewer, signalingURLRequest{
		Role:     string(RoleMaster),
		Endpoint: "wss://v-test.kinesisvideo.ap-northeast-1.amazonaws.com",
		QueryParams: map[string]string{
			"X-Amz-ChannelARN": kvs.channelARN,
		},
	}, http.StatusForbidden)
}

func TestStopRequiresOwner(t *testing.T) {
	server, _ := newTestServer(t)
	owner, viewer := tokens(t)
	created := createTestLive(t, server, owner, map[string]any{"title": "stop me", "public": true})
	requestJSONAs[sessionResponse](t, server, http.MethodPost, "/api/lives/"+created.ID+"/publisher-session", owner, map[string]any{}, http.StatusOK)

	requestJSONAs[map[string]string](t, server, http.MethodPost, "/api/lives/"+created.ID+"/stop", viewer, map[string]any{}, http.StatusForbidden)

	stopped := requestJSONAs[liveResponse](t, server, http.MethodPost, "/api/lives/"+created.ID+"/stop", owner, map[string]any{}, http.StatusOK)
	if stopped.Status != LiveStatusEnded {
		t.Fatalf("status = %q, want ended", stopped.Status)
	}
	if stopped.EndedAt == nil {
		t.Fatal("expected endedAt to be set")
	}
}

func requestJSONAs[T any](t *testing.T, handler http.Handler, method, path, token string, body any, wantStatus int) T {
	t.Helper()

	var reader *bytes.Reader
	if body != nil {
		payload, err := json.Marshal(body)
		if err != nil {
			t.Fatalf("marshal request: %v", err)
		}
		reader = bytes.NewReader(payload)
	} else {
		reader = bytes.NewReader(nil)
	}

	req := httptest.NewRequest(method, path, reader)
	req.Header.Set("Content-Type", "application/json")
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != wantStatus {
		t.Fatalf("%s %s status = %d, want %d; body=%s", method, path, rec.Code, wantStatus, rec.Body.String())
	}

	var decoded T
	if err := json.NewDecoder(rec.Body).Decode(&decoded); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	return decoded
}
