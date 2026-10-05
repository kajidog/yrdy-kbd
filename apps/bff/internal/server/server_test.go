package server

import (
	"bufio"
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"yrdy-kbd/apps/bff/internal/config"
	"yrdy-kbd/apps/bff/internal/graph/model"
	"yrdy-kbd/apps/bff/internal/kvs"
	"yrdy-kbd/apps/bff/internal/live"
)

type fakeKVSClient struct {
	channelARN string
	streamARN  string
	session    kvs.SessionConfig
	signedURL  string
	hlsURL     string

	ensuredChannelName string
	ensuredStreamName  string
	storageChannelARN  string
	joinedChannelARN   string
	lastSessionInput   kvs.SessionInput
	lastSignInput      kvs.SignalingURLInput
	lastHLSInput       kvs.HLSPlaybackInput
	sessionConfigCalls int
}

func (f *fakeKVSClient) EnsureSignalingChannel(_ context.Context, channelName string) (string, error) {
	f.ensuredChannelName = channelName
	return f.channelARN, nil
}

func (f *fakeKVSClient) SessionConfig(_ context.Context, input kvs.SessionInput) (kvs.SessionConfig, error) {
	f.sessionConfigCalls++
	f.lastSessionInput = input
	session := f.session
	session.Role = input.Role
	session.ChannelARN = input.ChannelARN
	return session, nil
}

func (f *fakeKVSClient) SignalingURL(_ context.Context, input kvs.SignalingURLInput) (string, error) {
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

func (f *fakeKVSClient) HLSPlaybackURL(_ context.Context, input kvs.HLSPlaybackInput) (string, error) {
	f.lastHLSInput = input
	return f.hlsURL, nil
}

func newTestServer(t *testing.T) (http.Handler, *fakeKVSClient) {
	t.Helper()
	streams, closeStreams := context.WithCancel(context.Background())
	t.Cleanup(closeStreams)
	return newTestServerWithStreams(t, streams)
}

func newTestServerWithStreams(t *testing.T, streams context.Context) (http.Handler, *fakeKVSClient) {
	t.Helper()
	fake := &fakeKVSClient{
		channelARN: "arn:aws:kinesisvideo:ap-northeast-1:123456789012:channel/yrdy-kbd-test/1",
		streamARN:  "arn:aws:kinesisvideo:ap-northeast-1:123456789012:stream/yrdy-kbd-test/1",
		signedURL:  "wss://signed.example.test",
		hlsURL:     "https://hls.example.test/session.m3u8",
		session: kvs.SessionConfig{
			Region: "ap-northeast-1",
			Endpoints: kvs.EndpointSet{
				WSS:   "wss://v-test.kinesisvideo.ap-northeast-1.amazonaws.com",
				HTTPS: "https://v-test.kinesisvideo.ap-northeast-1.amazonaws.com",
			},
			ICEServers: []kvs.ICEServer{{URLs: []string{"stun:stun.kinesisvideo.ap-northeast-1.amazonaws.com:443"}}},
		},
	}
	cfg := config.Config{
		Addr:            ":0",
		Region:          "ap-northeast-1",
		PublisherOrigin: "http://publisher.test",
		ViewerOrigin:    "http://viewer.test",
	}
	lives, err := live.NewStore("")
	if err != nil {
		t.Fatalf("new live store: %v", err)
	}
	return New(cfg, fake, lives, streams), fake
}

func bearerToken(t *testing.T, sub, username string) string {
	t.Helper()
	return bearerTokenWithClaims(t, map[string]any{
		"sub":              sub,
		"cognito:username": username,
	})
}

func bearerTokenWithClaims(t *testing.T, claims map[string]any) string {
	t.Helper()
	payload, err := json.Marshal(claims)
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

const liveFields = `
  id title ownerName public record status hasPassphrase hasRecording owned
  createdAt startedAt endedAt durationSeconds watchUrl
`

const sessionFields = `
  liveId role region channelArn
  endpoints { wss https }
  iceServers { urls username credential ttl }
`

type gqlError struct {
	Message string `json:"message"`
}

type gqlResponse struct {
	Data   map[string]json.RawMessage `json:"data"`
	Errors []gqlError                 `json:"errors"`
}

func execGQL(t *testing.T, handler http.Handler, token, query string, variables map[string]any) gqlResponse {
	t.Helper()

	body, err := json.Marshal(map[string]any{"query": query, "variables": variables})
	if err != nil {
		t.Fatalf("marshal request: %v", err)
	}

	req := httptest.NewRequest(http.MethodPost, "/graphql", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	var decoded gqlResponse
	if err := json.NewDecoder(rec.Body).Decode(&decoded); err != nil {
		t.Fatalf("decode response (status %d): %v; body=%s", rec.Code, err, rec.Body.String())
	}
	return decoded
}

// querySucceedsAs runs a query that must succeed and decodes data[field].
func querySucceedsAs[T any](t *testing.T, handler http.Handler, token, field, query string, variables map[string]any) T {
	t.Helper()
	resp := execGQL(t, handler, token, query, variables)
	if len(resp.Errors) > 0 {
		t.Fatalf("unexpected GraphQL errors: %+v", resp.Errors)
	}
	raw, ok := resp.Data[field]
	if !ok {
		t.Fatalf("response has no %q field: %+v", field, resp.Data)
	}
	var decoded T
	if err := json.Unmarshal(raw, &decoded); err != nil {
		t.Fatalf("decode %q: %v; raw=%s", field, err, raw)
	}
	return decoded
}

// queryFails runs a query that must fail and asserts on the first error message.
func queryFails(t *testing.T, handler http.Handler, token, query string, variables map[string]any, wantMessage string) {
	t.Helper()
	resp := execGQL(t, handler, token, query, variables)
	if len(resp.Errors) == 0 {
		t.Fatalf("expected GraphQL error %q, got none (data=%v)", wantMessage, resp.Data)
	}
	if !strings.Contains(resp.Errors[0].Message, wantMessage) {
		t.Fatalf("error = %q, want it to contain %q", resp.Errors[0].Message, wantMessage)
	}
}

func createTestLive(t *testing.T, handler http.Handler, token string, input map[string]any) model.Live {
	t.Helper()
	return querySucceedsAs[model.Live](t, handler, token, "createLive",
		`mutation CreateLive($input: CreateLiveInput!) { createLive(input: $input) {`+liveFields+`} }`,
		map[string]any{"input": input})
}

func startPublisherSession(t *testing.T, handler http.Handler, token, liveID string) model.SessionConfig {
	t.Helper()
	return querySucceedsAs[model.SessionConfig](t, handler, token, "createPublisherSession",
		`mutation Publish($liveId: ID!) { createPublisherSession(liveId: $liveId) {`+sessionFields+`} }`,
		map[string]any{"liveId": liveID})
}

func getLive(t *testing.T, handler http.Handler, token, liveID string) model.Live {
	t.Helper()
	return querySucceedsAs[model.Live](t, handler, token, "live",
		`query GetLive($id: ID!) { live(id: $id) {`+liveFields+`} }`,
		map[string]any{"id": liveID})
}

func TestRequestsWithoutTokenAreRejected(t *testing.T) {
	handler, _ := newTestServer(t)
	queryFails(t, handler, "",
		`mutation { createLive(input: { title: "no auth", public: true, record: false }) { id } }`,
		nil, "Authorization bearer token is required")
}

func TestRequestIDIsReturnedAndCorsExposed(t *testing.T) {
	handler, _ := newTestServer(t)
	req := httptest.NewRequest(http.MethodGet, "/healthz", nil)
	req.Header.Set("Origin", "http://viewer.test")
	req.Header.Set("X-Request-ID", "browser-request-123")
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	if got := rec.Header().Get("X-Request-ID"); got != "browser-request-123" {
		t.Errorf("X-Request-ID = %q, want browser-request-123", got)
	}
	if got := rec.Header().Get("Access-Control-Expose-Headers"); got != "X-Request-ID" {
		t.Errorf("Access-Control-Expose-Headers = %q, want X-Request-ID", got)
	}
}

func TestCreateLiveAndPublisherSession(t *testing.T) {
	handler, fake := newTestServer(t)
	owner, _ := tokens(t)

	created := createTestLive(t, handler, owner, map[string]any{
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
	if got, want := fake.ensuredChannelName, live.ChannelName(created.ID); got != want {
		t.Fatalf("ensured channel name = %q, want %q", got, want)
	}
	if got, want := fake.ensuredStreamName, live.StreamName(created.ID); got != want {
		t.Fatalf("ensured stream name = %q, want %q", got, want)
	}
	if fake.storageChannelARN != fake.channelARN {
		t.Fatalf("media storage configured for %q, want %q", fake.storageChannelARN, fake.channelARN)
	}
	if created.WatchURL != "http://viewer.test?liveId="+created.ID {
		t.Fatalf("unexpected watch URL: %s", created.WatchURL)
	}
	if created.Status != model.LiveStatusCreated {
		t.Fatalf("status = %q, want CREATED", created.Status)
	}

	session := startPublisherSession(t, handler, owner, created.ID)
	if session.Role != model.RoleMaster {
		t.Fatalf("session role = %q, want MASTER", session.Role)
	}
	if session.LiveID != created.ID {
		t.Fatalf("session liveId = %q, want %q", session.LiveID, created.ID)
	}

	fetched := getLive(t, handler, owner, created.ID)
	if fetched.Status != model.LiveStatusLive {
		t.Fatalf("status after publisher session = %q, want LIVE", fetched.Status)
	}
	if fetched.StartedAt == nil {
		t.Fatal("expected startedAt to be set")
	}
}

func TestPublisherSessionRequiresOwner(t *testing.T) {
	handler, _ := newTestServer(t)
	owner, viewer := tokens(t)
	created := createTestLive(t, handler, owner, map[string]any{"title": "owner only", "public": true, "record": false})

	queryFails(t, handler, viewer,
		`mutation Publish($liveId: ID!) { createPublisherSession(liveId: $liveId) { liveId } }`,
		map[string]any{"liveId": created.ID}, "only the owner can broadcast this live")
}

func TestPublisherSessionRejectsEndedLive(t *testing.T) {
	handler, fake := newTestServer(t)
	owner, _ := tokens(t)
	created := createTestLive(t, handler, owner, map[string]any{
		"title":  "recorded once",
		"public": true,
		"record": true,
	})

	startPublisherSession(t, handler, owner, created.ID)
	stopped := querySucceedsAs[model.Live](t, handler, owner, "stopLive",
		`mutation Stop($liveId: ID!) { stopLive(liveId: $liveId) {`+liveFields+`} }`,
		map[string]any{"liveId": created.ID})
	if stopped.EndedAt == nil {
		t.Fatal("expected stopped live to have endedAt")
	}

	callsBefore := fake.sessionConfigCalls
	queryFails(t, handler, owner,
		`mutation Publish($liveId: ID!) { createPublisherSession(liveId: $liveId) { liveId } }`,
		map[string]any{"liveId": created.ID}, "ended lives cannot be restarted")
	if fake.sessionConfigCalls != callsBefore {
		t.Fatalf("SessionConfig calls = %d, want %d", fake.sessionConfigCalls, callsBefore)
	}

	fetched := getLive(t, handler, owner, created.ID)
	if fetched.Status != model.LiveStatusEnded {
		t.Fatalf("status after rejected publisher session = %q, want ENDED", fetched.Status)
	}
	if fetched.EndedAt == nil {
		t.Fatal("expected endedAt to remain set")
	}
}

const viewerSessionMutation = `mutation Watch($input: ViewerSessionInput!) { createViewerSession(input: $input) {` + sessionFields + `} }`

func TestViewerSessionPassphraseAndStatus(t *testing.T) {
	handler, _ := newTestServer(t)
	owner, viewer := tokens(t)
	created := createTestLive(t, handler, owner, map[string]any{
		"title":      "guarded",
		"passphrase": "correct",
		"public":     false,
		"record":     false,
	})

	// Not broadcasting yet.
	queryFails(t, handler, viewer, viewerSessionMutation,
		map[string]any{"input": map[string]any{"liveId": created.ID, "passphrase": "correct", "clientId": "viewer-1"}},
		"live is not broadcasting")

	startPublisherSession(t, handler, owner, created.ID)

	queryFails(t, handler, viewer, viewerSessionMutation,
		map[string]any{"input": map[string]any{"liveId": created.ID, "passphrase": "wrong", "clientId": "viewer-1"}},
		"passphrase does not match")

	queryFails(t, handler, viewer, viewerSessionMutation,
		map[string]any{"input": map[string]any{"liveId": created.ID, "passphrase": "correct", "clientId": ""}},
		"clientId is required")

	session := querySucceedsAs[model.SessionConfig](t, handler, viewer, "createViewerSession", viewerSessionMutation,
		map[string]any{"input": map[string]any{"liveId": created.ID, "passphrase": "correct", "clientId": "viewer-1"}})
	if session.Role != model.RoleViewer {
		t.Fatalf("session role = %q, want VIEWER", session.Role)
	}
}

func TestLiveWithoutPassphraseIsOpen(t *testing.T) {
	handler, _ := newTestServer(t)
	owner, viewer := tokens(t)
	created := createTestLive(t, handler, owner, map[string]any{"title": "open live", "public": true, "record": false})
	if created.HasPassphrase {
		t.Fatal("expected no passphrase")
	}

	startPublisherSession(t, handler, owner, created.ID)
	querySucceedsAs[model.SessionConfig](t, handler, viewer, "createViewerSession", viewerSessionMutation,
		map[string]any{"input": map[string]any{"liveId": created.ID, "clientId": "viewer-1"}})
}

func TestSearchListsPublicLivesOnly(t *testing.T) {
	handler, _ := newTestServer(t)
	owner, viewer := tokens(t)

	public := createTestLive(t, handler, owner, map[string]any{"title": "public gaming", "public": true, "record": false})
	private := createTestLive(t, handler, owner, map[string]any{"title": "secret meeting", "public": false, "record": false})
	startPublisherSession(t, handler, owner, public.ID)
	startPublisherSession(t, handler, owner, private.ID)

	searchQuery := `query Search($query: String) { lives(query: $query) {` + liveFields + `} }`

	all := querySucceedsAs[[]model.Live](t, handler, viewer, "lives", searchQuery, map[string]any{"query": ""})
	if len(all) != 1 || all[0].ID != public.ID {
		t.Fatalf("search should list only the public live, got %+v", all)
	}

	byTitle := querySucceedsAs[[]model.Live](t, handler, viewer, "lives", searchQuery, map[string]any{"query": "gaming"})
	if len(byTitle) != 1 {
		t.Fatalf("expected title match, got %+v", byTitle)
	}

	byOwner := querySucceedsAs[[]model.Live](t, handler, viewer, "lives", searchQuery, map[string]any{"query": "ALICE"})
	if len(byOwner) != 1 {
		t.Fatalf("expected owner-name match, got %+v", byOwner)
	}

	none := querySucceedsAs[[]model.Live](t, handler, viewer, "lives", searchQuery, map[string]any{"query": "nothing"})
	if len(none) != 0 {
		t.Fatalf("expected no match, got %+v", none)
	}

	mine := querySucceedsAs[[]model.Live](t, handler, owner, "myLives",
		`query { myLives {`+liveFields+`} }`, nil)
	if len(mine) != 2 {
		t.Fatalf("owner should see both lives, got %d", len(mine))
	}
}

const playbackMutation = `mutation Playback($input: PlaybackInput!) {
  createPlayback(input: $input) { liveId hlsUrl playbackMode startedAt endedAt durationSeconds }
}`

func TestPlaybackForRecordedLive(t *testing.T) {
	handler, fake := newTestServer(t)
	owner, viewer := tokens(t)
	created := createTestLive(t, handler, owner, map[string]any{
		"title":  "recorded live",
		"public": true,
		"record": true,
	})

	// No recording before the broadcast started.
	queryFails(t, handler, viewer, playbackMutation,
		map[string]any{"input": map[string]any{"liveId": created.ID}}, "this live has no recording")

	startPublisherSession(t, handler, owner, created.ID)

	joined := querySucceedsAs[bool](t, handler, owner, "joinStorageSession",
		`mutation Join($liveId: ID!) { joinStorageSession(liveId: $liveId) }`,
		map[string]any{"liveId": created.ID})
	if !joined {
		t.Fatal("expected joinStorageSession to return true")
	}
	if fake.joinedChannelARN != fake.channelARN {
		t.Fatalf("storage session joined %q, want %q", fake.joinedChannelARN, fake.channelARN)
	}

	// While live, playback uses LIVE mode.
	livePlayback := querySucceedsAs[model.Playback](t, handler, viewer, "createPlayback", playbackMutation,
		map[string]any{"input": map[string]any{"liveId": created.ID}})
	if livePlayback.PlaybackMode != model.PlaybackModeLive || !fake.lastHLSInput.Live {
		t.Fatalf("expected LIVE playback, got %+v", livePlayback)
	}

	querySucceedsAs[model.Live](t, handler, owner, "stopLive",
		`mutation Stop($liveId: ID!) { stopLive(liveId: $liveId) { id } }`,
		map[string]any{"liveId": created.ID})

	playback := querySucceedsAs[model.Playback](t, handler, viewer, "createPlayback", playbackMutation,
		map[string]any{"input": map[string]any{"liveId": created.ID}})
	if playback.PlaybackMode != model.PlaybackModeOnDemand || fake.lastHLSInput.Live {
		t.Fatalf("expected ON_DEMAND playback, got %+v", playback)
	}
	if playback.HlsURL != fake.hlsURL {
		t.Fatalf("hls url = %q, want %q", playback.HlsURL, fake.hlsURL)
	}
	if fake.lastHLSInput.StreamARN != fake.streamARN {
		t.Fatalf("hls stream arn = %q, want %q", fake.lastHLSInput.StreamARN, fake.streamARN)
	}
	if playback.StartedAt == nil || playback.EndedAt == nil {
		t.Fatalf("expected playback range, got %+v", playback)
	}
}

func TestStorageSessionRequiresRecordingEnabled(t *testing.T) {
	handler, _ := newTestServer(t)
	owner, _ := tokens(t)
	created := createTestLive(t, handler, owner, map[string]any{"title": "no recording", "public": true, "record": false})

	queryFails(t, handler, owner,
		`mutation Join($liveId: ID!) { joinStorageSession(liveId: $liveId) }`,
		map[string]any{"liveId": created.ID}, "recording is not enabled for this live")
}

const signMutation = `mutation Sign($input: SignSignalingUrlInput!) {
  signSignalingUrl(input: $input) { signedUrl }
}`

func TestSignalingURLValidation(t *testing.T) {
	handler, fake := newTestServer(t)
	owner, viewer := tokens(t)
	created := createTestLive(t, handler, owner, map[string]any{
		"title":      "signal",
		"passphrase": "correct",
		"public":     true,
		"record":     false,
	})
	startPublisherSession(t, handler, owner, created.ID)

	signed := querySucceedsAs[model.SignedURL](t, handler, viewer, "signSignalingUrl", signMutation,
		map[string]any{"input": map[string]any{
			"liveId":     created.ID,
			"passphrase": "correct",
			"role":       "VIEWER",
			"clientId":   "viewer-1",
			"endpoint":   "wss://v-test.kinesisvideo.ap-northeast-1.amazonaws.com",
			"queryParams": map[string]string{
				"X-Amz-ChannelARN": fake.channelARN,
				"X-Amz-ClientId":   "viewer-1",
			},
		}})
	if signed.SignedURL != fake.signedURL {
		t.Fatalf("signed URL = %q, want %q", signed.SignedURL, fake.signedURL)
	}

	// Mismatched client id in query params.
	queryFails(t, handler, viewer, signMutation,
		map[string]any{"input": map[string]any{
			"liveId":     created.ID,
			"passphrase": "correct",
			"role":       "VIEWER",
			"clientId":   "viewer-1",
			"endpoint":   "wss://v-test.kinesisvideo.ap-northeast-1.amazonaws.com",
			"queryParams": map[string]string{
				"X-Amz-ChannelARN": fake.channelARN,
				"X-Amz-ClientId":   "viewer-2",
			},
		}}, "queryParams X-Amz-ClientId does not match clientId")

	// Only the owner may sign MASTER URLs.
	queryFails(t, handler, viewer, signMutation,
		map[string]any{"input": map[string]any{
			"liveId":   created.ID,
			"role":     "MASTER",
			"endpoint": "wss://v-test.kinesisvideo.ap-northeast-1.amazonaws.com",
			"queryParams": map[string]string{
				"X-Amz-ChannelARN": fake.channelARN,
			},
		}}, "only the owner can sign master URLs")
}

func TestStopRequiresOwner(t *testing.T) {
	handler, _ := newTestServer(t)
	owner, viewer := tokens(t)
	created := createTestLive(t, handler, owner, map[string]any{"title": "stop me", "public": true, "record": false})
	startPublisherSession(t, handler, owner, created.ID)

	queryFails(t, handler, viewer,
		`mutation Stop($liveId: ID!) { stopLive(liveId: $liveId) { id } }`,
		map[string]any{"liveId": created.ID}, "only the owner can stop this live")

	stopped := querySucceedsAs[model.Live](t, handler, owner, "stopLive",
		`mutation Stop($liveId: ID!) { stopLive(liveId: $liveId) {`+liveFields+`} }`,
		map[string]any{"liveId": created.ID})
	if stopped.Status != model.LiveStatusEnded {
		t.Fatalf("status = %q, want ENDED", stopped.Status)
	}
	if stopped.EndedAt == nil {
		t.Fatal("expected endedAt to be set")
	}
}

// sseEvents opens a graphql-sse (distinct connections mode) subscription and
// returns a channel of decoded "next" payloads.
func sseEvents(t *testing.T, serverURL, token, query string) <-chan gqlResponse {
	t.Helper()
	body, err := json.Marshal(map[string]any{"query": query})
	if err != nil {
		t.Fatalf("marshal request: %v", err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, serverURL+"/graphql", bytes.NewReader(body))
	if err != nil {
		t.Fatalf("new request: %v", err)
	}
	req.Header.Set("Content-Type", "application/json; charset=utf-8")
	req.Header.Set("Accept", "text/event-stream")
	req.Header.Set("Authorization", "Bearer "+token)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("open SSE stream: %v", err)
	}
	t.Cleanup(func() { _ = resp.Body.Close() })
	if got := resp.Header.Get("Content-Type"); got != "text/event-stream" {
		t.Fatalf("Content-Type = %q, want text/event-stream", got)
	}

	events := make(chan gqlResponse)
	go func() {
		defer close(events)
		scanner := bufio.NewScanner(resp.Body)
		scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)
		event := ""
		for scanner.Scan() {
			line := scanner.Text()
			switch {
			case strings.HasPrefix(line, "event: "):
				event = strings.TrimPrefix(line, "event: ")
			case strings.HasPrefix(line, "data: ") && event == "next":
				var decoded gqlResponse
				if err := json.Unmarshal([]byte(strings.TrimPrefix(line, "data: ")), &decoded); err != nil {
					return
				}
				select {
				case events <- decoded:
				case <-ctx.Done():
					return
				}
			}
		}
	}()
	return events
}

func nextMyLives(t *testing.T, events <-chan gqlResponse) []model.Live {
	t.Helper()
	select {
	case resp, ok := <-events:
		if !ok {
			t.Fatal("SSE stream closed")
		}
		if len(resp.Errors) > 0 {
			t.Fatalf("unexpected GraphQL errors: %+v", resp.Errors)
		}
		var lives []model.Live
		if err := json.Unmarshal(resp.Data["myLives"], &lives); err != nil {
			t.Fatalf("decode myLives: %v", err)
		}
		return lives
	case <-time.After(10 * time.Second):
		t.Fatal("timed out waiting for an SSE event")
		return nil
	}
}

func TestMyLivesSubscriptionPushesFullListOverSSE(t *testing.T) {
	handler, _ := newTestServer(t)
	server := httptest.NewServer(handler)
	// Cleanup (not defer) so the SSE stream is closed first; Close waits for it.
	t.Cleanup(server.Close)
	owner, viewer := tokens(t)

	created := createTestLive(t, handler, owner, map[string]any{"title": "subscribed", "public": true, "record": false})
	createTestLive(t, handler, viewer, map[string]any{"title": "someone else's", "public": true, "record": false})

	events := sseEvents(t, server.URL, owner, `subscription { myLives {`+liveFields+`} }`)

	// The current state arrives right away.
	first := nextMyLives(t, events)
	if len(first) != 1 || first[0].ID != created.ID || first[0].Status != model.LiveStatusCreated {
		t.Fatalf("first event = %+v, want only %s in CREATED", first, created.ID)
	}

	// Changes made through mutations show up in a later full snapshot.
	startPublisherSession(t, handler, owner, created.ID)
	for {
		lives := nextMyLives(t, events)
		if len(lives) == 1 && lives[0].Status == model.LiveStatusLive {
			break
		}
	}
}

func TestMyLivesSubscriptionRequiresToken(t *testing.T) {
	handler, _ := newTestServer(t)
	server := httptest.NewServer(handler)
	// Cleanup (not defer) so the SSE stream is closed first; Close waits for it.
	t.Cleanup(server.Close)

	events := sseEvents(t, server.URL, "", `subscription { myLives { id } }`)
	select {
	case resp := <-events:
		if len(resp.Errors) == 0 || !strings.Contains(resp.Errors[0].Message, "Authorization bearer token is required") {
			t.Fatalf("errors = %+v, want missing token error", resp.Errors)
		}
	case <-time.After(10 * time.Second):
		t.Fatal("timed out waiting for an SSE event")
	}
}

// waitForStreamEnd drains events until the server ends the SSE stream.
func waitForStreamEnd(t *testing.T, events <-chan gqlResponse, timeout time.Duration) {
	t.Helper()
	deadline := time.After(timeout)
	for {
		select {
		case _, ok := <-events:
			if !ok {
				return
			}
		case <-deadline:
			t.Fatal("SSE stream did not end")
		}
	}
}

func TestMyLivesSubscriptionEndsWhenTokenExpires(t *testing.T) {
	handler, _ := newTestServer(t)
	server := httptest.NewServer(handler)
	t.Cleanup(server.Close)
	token := bearerTokenWithClaims(t, map[string]any{
		"sub":              "owner-sub",
		"cognito:username": "alice",
		"exp":              time.Now().Add(2 * time.Second).Unix(),
	})

	events := sseEvents(t, server.URL, token, `subscription { myLives { id } }`)
	nextMyLives(t, events)
	waitForStreamEnd(t, events, 5*time.Second)
}

func TestMyLivesSubscriptionRejectsExpiredToken(t *testing.T) {
	handler, _ := newTestServer(t)
	server := httptest.NewServer(handler)
	t.Cleanup(server.Close)
	token := bearerTokenWithClaims(t, map[string]any{
		"sub":              "owner-sub",
		"cognito:username": "alice",
		"exp":              time.Now().Add(-time.Minute).Unix(),
	})

	events := sseEvents(t, server.URL, token, `subscription { myLives { id } }`)
	select {
	case resp := <-events:
		if len(resp.Errors) == 0 || !strings.Contains(resp.Errors[0].Message, "token has expired") {
			t.Fatalf("errors = %+v, want token expired error", resp.Errors)
		}
	case <-time.After(10 * time.Second):
		t.Fatal("timed out waiting for an SSE event")
	}
}

func TestMyLivesSubscriptionEndsWhenStreamsAreClosed(t *testing.T) {
	streams, closeStreams := context.WithCancel(context.Background())
	t.Cleanup(closeStreams)
	handler, _ := newTestServerWithStreams(t, streams)
	server := httptest.NewServer(handler)
	t.Cleanup(server.Close)
	owner, _ := tokens(t)

	events := sseEvents(t, server.URL, owner, `subscription { myLives { id } }`)
	nextMyLives(t, events)
	closeStreams()
	waitForStreamEnd(t, events, 5*time.Second)
}
