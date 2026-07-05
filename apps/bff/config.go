package main

import (
	"fmt"
	"os"
)

type Config struct {
	Addr            string
	Region          string
	PublisherOrigin string
	ViewerOrigin    string
}

func loadConfig() (Config, error) {
	cfg := Config{
		Addr:            envOrDefault("BFF_ADDR", ":8080"),
		Region:          envOrDefault("AWS_REGION", ""),
		PublisherOrigin: envOrDefault("PUBLISHER_ORIGIN", "http://localhost:5173"),
		ViewerOrigin:    envOrDefault("VIEWER_ORIGIN", "http://localhost:5174"),
	}
	if cfg.Region == "" {
		return Config{}, fmt.Errorf("AWS_REGION is required")
	}
	return cfg, nil
}

func envOrDefault(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}
