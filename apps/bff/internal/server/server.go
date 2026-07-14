// Package server wires the GraphQL handler, auth middleware, and CORS into
// the HTTP handler the BFF serves.
package server

import (
	"crypto/rand"
	"encoding/hex"
	"log/slog"
	"net/http"
	"strings"
	"time"

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

	return withRequestLogging(withCORS(cfg, mux))
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
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Request-ID")
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
			w.Header().Set("Access-Control-Expose-Headers", "X-Request-ID")
		}
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

type statusWriter struct {
	http.ResponseWriter
	status       int
	bytesWritten int
}

func (w *statusWriter) WriteHeader(status int) {
	if w.status != 0 {
		return
	}
	w.status = status
	w.ResponseWriter.WriteHeader(status)
}

func (w *statusWriter) Write(body []byte) (int, error) {
	if w.status == 0 {
		w.status = http.StatusOK
	}
	written, err := w.ResponseWriter.Write(body)
	w.bytesWritten += written
	return written, err
}

func (w *statusWriter) Unwrap() http.ResponseWriter { return w.ResponseWriter }

func withRequestLogging(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		started := time.Now()
		requestID := validRequestID(r.Header.Get("X-Request-ID"))
		if requestID == "" {
			requestID = newRequestID()
		}
		w.Header().Set("X-Request-ID", requestID)

		wrapped := &statusWriter{ResponseWriter: w}
		next.ServeHTTP(wrapped, r)
		if wrapped.status == 0 {
			wrapped.status = http.StatusOK
		}

		logger := slog.Default()
		args := []any{
			"event_name", "http_request_completed",
			"request_id", requestID,
			"http.method", r.Method,
			"http.url_details.path", r.URL.Path,
			"http.status_code", wrapped.status,
			"http.response.body.bytes", wrapped.bytesWritten,
			"duration_ms", float64(time.Since(started).Microseconds()) / 1000,
		}
		switch {
		case wrapped.status >= http.StatusInternalServerError:
			logger.Error("HTTP request completed", args...)
		case wrapped.status >= http.StatusBadRequest:
			logger.Warn("HTTP request completed", args...)
		default:
			logger.Info("HTTP request completed", args...)
		}
	})
}

func validRequestID(value string) string {
	if value == "" || len(value) > 128 {
		return ""
	}
	for _, char := range value {
		if !(char == '-' || char == '_' || char >= '0' && char <= '9' || char >= 'a' && char <= 'z' || char >= 'A' && char <= 'Z') {
			return ""
		}
	}
	return strings.TrimSpace(value)
}

func newRequestID() string {
	var value [16]byte
	if _, err := rand.Read(value[:]); err != nil {
		return hex.EncodeToString([]byte(time.Now().UTC().Format(time.RFC3339Nano)))
	}
	return hex.EncodeToString(value[:])
}
