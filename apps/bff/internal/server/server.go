// Package server wires the GraphQL handler, auth middleware, and CORS into
// the HTTP handler the BFF serves.
package server

import (
	"net/http"

	"github.com/99designs/gqlgen/graphql/handler"
	"github.com/99designs/gqlgen/graphql/handler/extension"
	"github.com/99designs/gqlgen/graphql/handler/lru"
	"github.com/99designs/gqlgen/graphql/handler/transport"
	"github.com/99designs/gqlgen/graphql/playground"
	"github.com/vektah/gqlparser/v2/ast"

	"yrdy-kbd/apps/bff/internal/auth"
	"yrdy-kbd/apps/bff/internal/config"
	"yrdy-kbd/apps/bff/internal/graph"
	"yrdy-kbd/apps/bff/internal/kvs"
	"yrdy-kbd/apps/bff/internal/live"
)

func New(cfg config.Config, kvsClient kvs.Client, lives *live.Store) http.Handler {
	gql := handler.New(graph.NewExecutableSchema(graph.Config{
		Resolvers: &graph.Resolver{Cfg: cfg, KVS: kvsClient, LiveStore: lives},
	}))
	gql.AddTransport(transport.Options{})
	gql.AddTransport(transport.POST{})
	gql.SetQueryCache(lru.New[*ast.QueryDocument](1000))
	gql.Use(extension.Introspection{})

	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"status":"ok"}` + "\n"))
	})
	mux.Handle("POST /graphql", auth.Middleware(gql))
	mux.Handle("GET /graphql", playground.Handler("yrdy-kbd GraphQL", "/graphql"))

	return withCORS(cfg, mux)
}

func withCORS(cfg config.Config, next http.Handler) http.Handler {
	allowed := map[string]bool{
		cfg.PublisherOrigin: true,
		cfg.ViewerOrigin:    true,
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
