package main

import (
	"fmt"
	"os"
	"strconv"
)

type Config struct {
	Addr            string
	Region          string
	PublisherOrigin string
	ViewerOrigin    string
	DataFile        string
	RetentionHours  int32
}

func loadConfig() (Config, error) {
	cfg := Config{
		Addr:            envOrDefault("BFF_ADDR", ":8080"),
		Region:          envOrDefault("AWS_REGION", ""),
		PublisherOrigin: envOrDefault("PUBLISHER_ORIGIN", "http://localhost:5173"),
		ViewerOrigin:    envOrDefault("VIEWER_ORIGIN", "http://localhost:5174"),
		DataFile:        envOrDefault("BFF_DATA_FILE", "data/lives.json"),
	}
	if cfg.Region == "" {
		return Config{}, fmt.Errorf("AWS_REGION is required")
	}

	retention := envOrDefault("KVS_RETENTION_HOURS", "72")
	hours, err := strconv.ParseInt(retention, 10, 32)
	if err != nil || hours < 1 {
		return Config{}, fmt.Errorf("KVS_RETENTION_HOURS must be a positive integer, got %q", retention)
	}
	cfg.RetentionHours = int32(hours)

	return cfg, nil
}

func envOrDefault(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}
