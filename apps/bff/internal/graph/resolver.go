package graph

import (
	"yrdy-kbd/apps/bff/internal/config"
	"yrdy-kbd/apps/bff/internal/kvs"
	"yrdy-kbd/apps/bff/internal/live"
)

// Resolver holds the dependencies shared by all resolvers. gqlgen wires it
// into the generated executable schema.
type Resolver struct {
	Cfg       config.Config
	KVS       kvs.Client
	LiveStore *live.Store
}
