package graph

import (
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
}
