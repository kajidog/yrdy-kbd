package graph

import (
	"context"
	"time"

	"yrdy-kbd/apps/bff/internal/config"
	"yrdy-kbd/apps/bff/internal/kvs"
	"yrdy-kbd/apps/bff/internal/live"
)

// myLivesPollInterval is how often the myLives subscription re-reads the
// live store and pushes the list to the client.
const myLivesPollInterval = 2 * time.Second

// Resolver holds the dependencies shared by all resolvers. gqlgen wires it
// into the generated executable schema.
type Resolver struct {
	Cfg       config.Config
	KVS       kvs.Client
	LiveStore *live.Store
	// Streams is canceled when the server starts shutting down; open
	// subscriptions end then so http.Server.Shutdown does not wait on them.
	// Nil means subscriptions only end with their request.
	Streams context.Context
}
