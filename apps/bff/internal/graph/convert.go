package graph

import (
	"fmt"
	"net/url"
	"time"

	"yrdy-kbd/apps/bff/internal/graph/model"
	"yrdy-kbd/apps/bff/internal/kvs"
	"yrdy-kbd/apps/bff/internal/live"
)

func (r *Resolver) toLive(entry live.Live, viewerID string) *model.Live {
	var duration int
	if entry.StartedAt != nil {
		end := time.Now().UTC()
		if entry.EndedAt != nil {
			end = *entry.EndedAt
		}
		duration = int(end.Sub(*entry.StartedAt).Seconds())
	}
	return &model.Live{
		ID:              entry.ID,
		Title:           entry.Title,
		OwnerName:       entry.OwnerName,
		Public:          entry.Public,
		Record:          entry.Record,
		Status:          statusToModel(entry.Status),
		HasPassphrase:   entry.HasPassphrase(),
		HasRecording:    entry.HasRecording(),
		Owned:           entry.OwnerID == viewerID,
		CreatedAt:       entry.CreatedAt,
		StartedAt:       entry.StartedAt,
		EndedAt:         entry.EndedAt,
		DurationSeconds: duration,
		WatchURL:        watchURL(r.Cfg.ViewerOrigin, entry.ID),
	}
}

func (r *Resolver) toLives(entries []live.Live, viewerID string) []*model.Live {
	lives := make([]*model.Live, 0, len(entries))
	for _, entry := range entries {
		lives = append(lives, r.toLive(entry, viewerID))
	}
	return lives
}

func statusToModel(status live.Status) model.LiveStatus {
	switch status {
	case live.StatusLive:
		return model.LiveStatusLive
	case live.StatusEnded:
		return model.LiveStatusEnded
	default:
		return model.LiveStatusCreated
	}
}

func toSessionConfig(liveID string, session kvs.SessionConfig) *model.SessionConfig {
	servers := make([]*model.IceServer, 0, len(session.ICEServers))
	for _, item := range session.ICEServers {
		server := &model.IceServer{Urls: item.URLs}
		if item.Username != "" {
			server.Username = ptr(item.Username)
		}
		if item.Credential != "" {
			server.Credential = ptr(item.Credential)
		}
		if item.TTL != 0 {
			server.TTL = ptr(int(item.TTL))
		}
		servers = append(servers, server)
	}
	return &model.SessionConfig{
		LiveID:     liveID,
		Role:       model.Role(session.Role),
		Region:     session.Region,
		ChannelArn: session.ChannelARN,
		Endpoints:  &model.EndpointSet{Wss: session.Endpoints.WSS, HTTPS: session.Endpoints.HTTPS},
		IceServers: servers,
	}
}

// requireLive loads a live by ID or returns an error suitable as a GraphQL
// error.
func (r *Resolver) requireLive(liveID string) (live.Live, error) {
	if liveID == "" {
		return live.Live{}, fmt.Errorf("liveID is required")
	}
	entry, ok := r.LiveStore.Get(liveID)
	if !ok {
		return live.Live{}, fmt.Errorf("live not found")
	}
	return entry, nil
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

func ptr[T any](value T) *T {
	return &value
}

func deref(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}
