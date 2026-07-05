package main

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

type fakeKVSClient struct {
	channelARN string
	session    SessionConfig
	signedURL  string

	ensuredChannelName string
	lastSessionInput   SessionInput
	lastSignInput      SignalingURLInput
}

func (f *fakeKVSClient) EnsureSignalingChannel(_ context.Context, channelName string) (string, error) {
	f.ensuredChannelName = channelName
	return f.channelARN, nil
}

func (f *fakeKVSClient) SessionConfig(_ context.Context, input SessionInput) (SessionConfig, error) {
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

func newTestServer() (*Server, *fakeKVSClient) {
	kvs := &fakeKVSClient{
		channelARN: "arn:aws:kinesisvideo:ap-northeast-1:123456789012:channel/yrdy-kbd-test/1",
		signedURL:  "wss://signed.example.test",
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
	return NewServer(cfg, kvs, NewRoomStore()), kvs
}

func TestCreateRoomAndPublisherSession(t *testing.T) {
	server, kvs := newTestServer()

	createRes := postJSON[createRoomResponse](t, server, "/api/rooms", map[string]string{
		"passphrase": "open-sesame",
	}, http.StatusCreated)

	if createRes.RoomID == "" {
		t.Fatal("expected room id")
	}
	if createRes.ChannelARN != kvs.channelARN {
		t.Fatalf("unexpected channel arn: %s", createRes.ChannelARN)
	}
	if got, want := kvs.ensuredChannelName, channelNameForRoom(createRes.RoomID); got != want {
		t.Fatalf("ensured channel name = %q, want %q", got, want)
	}
	if createRes.PublishURL != "http://publisher.test?roomId="+createRes.RoomID {
		t.Fatalf("unexpected publish URL: %s", createRes.PublishURL)
	}
	if createRes.WatchURL != "http://viewer.test?roomId="+createRes.RoomID {
		t.Fatalf("unexpected watch URL: %s", createRes.WatchURL)
	}

	sessionRes := postJSON[sessionResponse](t, server, "/api/rooms/"+createRes.RoomID+"/publisher-session", map[string]string{
		"passphrase": "open-sesame",
	}, http.StatusOK)

	if sessionRes.Role != RoleMaster {
		t.Fatalf("session role = %q, want MASTER", sessionRes.Role)
	}
	if kvs.lastSessionInput.Role != RoleMaster {
		t.Fatalf("last session role = %q, want MASTER", kvs.lastSessionInput.Role)
	}
}

func TestSessionRejectsWrongPassphrase(t *testing.T) {
	server, _ := newTestServer()
	createRes := postJSON[createRoomResponse](t, server, "/api/rooms", map[string]string{
		"passphrase": "correct",
	}, http.StatusCreated)

	postJSON[map[string]string](t, server, "/api/rooms/"+createRes.RoomID+"/viewer-session", map[string]string{
		"passphrase": "wrong",
		"clientId":   "viewer-1",
	}, http.StatusForbidden)
}

func TestViewerSessionRequiresClientID(t *testing.T) {
	server, _ := newTestServer()
	createRes := postJSON[createRoomResponse](t, server, "/api/rooms", map[string]string{
		"passphrase": "correct",
	}, http.StatusCreated)

	postJSON[map[string]string](t, server, "/api/rooms/"+createRes.RoomID+"/viewer-session", map[string]string{
		"passphrase": "correct",
	}, http.StatusBadRequest)
}

func TestSignalingURLValidation(t *testing.T) {
	server, kvs := newTestServer()
	createRes := postJSON[createRoomResponse](t, server, "/api/rooms", map[string]string{
		"passphrase": "correct",
	}, http.StatusCreated)

	res := postJSON[signalingURLResponse](t, server, "/api/rooms/"+createRes.RoomID+"/signaling-url", signalingURLRequest{
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
	if kvs.lastSignInput.QueryParams["X-Amz-ClientId"] != "viewer-1" {
		t.Fatalf("signing input did not include viewer client id")
	}

	postJSON[map[string]string](t, server, "/api/rooms/"+createRes.RoomID+"/signaling-url", signalingURLRequest{
		Passphrase: "correct",
		Role:       string(RoleViewer),
		ClientID:   "viewer-1",
		Endpoint:   "wss://v-test.kinesisvideo.ap-northeast-1.amazonaws.com",
		QueryParams: map[string]string{
			"X-Amz-ChannelARN": kvs.channelARN,
			"X-Amz-ClientId":   "viewer-2",
		},
	}, http.StatusBadRequest)
}

func postJSON[T any](t *testing.T, handler http.Handler, path string, body any, wantStatus int) T {
	t.Helper()

	payload, err := json.Marshal(body)
	if err != nil {
		t.Fatalf("marshal request: %v", err)
	}

	req := httptest.NewRequest(http.MethodPost, path, bytes.NewReader(payload))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != wantStatus {
		t.Fatalf("POST %s status = %d, want %d; body=%s", path, rec.Code, wantStatus, rec.Body.String())
	}

	var decoded T
	if err := json.NewDecoder(rec.Body).Decode(&decoded); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	return decoded
}
