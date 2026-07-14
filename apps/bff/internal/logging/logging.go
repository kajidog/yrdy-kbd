// Package logging configures structured application logs for stdout and Datadog.
package logging

import (
	"io"
	"log/slog"
	"strings"
)

type Config struct {
	Level       string
	Service     string
	Environment string
	Version     string
}

// New creates a JSON logger whose reserved attributes are understood by
// Datadog's log pipelines. The output remains useful with docker logs and other
// JSON-aware collectors when Datadog is disabled.
func New(out io.Writer, cfg Config) *slog.Logger {
	handler := slog.NewJSONHandler(out, &slog.HandlerOptions{
		Level: parseLevel(cfg.Level),
		ReplaceAttr: func(_ []string, attr slog.Attr) slog.Attr {
			switch attr.Key {
			case slog.TimeKey:
				attr.Key = "timestamp"
			case slog.LevelKey:
				attr.Key = "status"
				attr.Value = slog.StringValue(strings.ToLower(attr.Value.String()))
			case slog.MessageKey:
				attr.Key = "message"
			}
			return attr
		},
	})

	return slog.New(handler).With(
		"service", cfg.Service,
		"env", cfg.Environment,
		"version", cfg.Version,
		"ddsource", "go",
	)
}

func parseLevel(value string) slog.Level {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "debug":
		return slog.LevelDebug
	case "warn", "warning":
		return slog.LevelWarn
	case "error":
		return slog.LevelError
	default:
		return slog.LevelInfo
	}
}
