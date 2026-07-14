package logging

import (
	"bytes"
	"encoding/json"
	"testing"
)

func TestNewWritesDatadogCompatibleJSON(t *testing.T) {
	var output bytes.Buffer
	logger := New(&output, Config{
		Level:       "debug",
		Service:     "yrdy-kbd-bff",
		Environment: "test",
		Version:     "abc123",
	})

	logger.Warn("request completed", "status_code", 503)

	var entry map[string]any
	if err := json.Unmarshal(output.Bytes(), &entry); err != nil {
		t.Fatalf("unmarshal log: %v; output=%s", err, output.String())
	}
	for key, want := range map[string]any{
		"status":      "warn",
		"message":     "request completed",
		"service":     "yrdy-kbd-bff",
		"env":         "test",
		"version":     "abc123",
		"ddsource":    "go",
		"status_code": float64(503),
	} {
		if got := entry[key]; got != want {
			t.Errorf("entry[%q] = %#v, want %#v", key, got, want)
		}
	}
	if entry["timestamp"] == nil {
		t.Error("timestamp is missing")
	}
}

func TestNewHonorsLogLevel(t *testing.T) {
	var output bytes.Buffer
	logger := New(&output, Config{Level: "error"})

	logger.Info("ignored")
	logger.Error("included")

	if output.String() == "" {
		t.Fatal("expected error log")
	}
	var entry struct {
		Status  string `json:"status"`
		Message string `json:"message"`
	}
	if err := json.Unmarshal(output.Bytes(), &entry); err != nil {
		t.Fatal(err)
	}
	if entry.Status != "error" {
		t.Errorf("status = %q, want error", entry.Status)
	}
	if entry.Message != "included" {
		t.Errorf("message = %q, want included", entry.Message)
	}
}
