package config

import (
	"os"
	"strconv"
	"strings"
	"time"
)

type Config struct {
	AppPort              string
	DatabaseURL          string
	CORSAllowedOrigins   []string
	USGSMinMagnitude     float64
	USGSHistoryDays      int
	USGSHistoryChunkDays int
	USGSSyncFeed         string
	HTTPTimeout          time.Duration
}

func Load() Config {
	return Config{
		AppPort:              getEnv("APP_PORT", "8080"),
		DatabaseURL:          getEnv("DATABASE_URL", "postgres://postgres:postgres@localhost:5432/earthquakes?sslmode=disable"),
		CORSAllowedOrigins:   splitCSV(getEnv("CORS_ALLOWED_ORIGINS", "http://localhost:3000")),
		USGSMinMagnitude:     getEnvFloat("USGS_MIN_MAGNITUDE", 2.5),
		USGSHistoryDays:      getEnvInt("USGS_HISTORY_DAYS", 365),
		USGSHistoryChunkDays: getEnvInt("USGS_HISTORY_CHUNK_DAYS", 30),
		USGSSyncFeed:         getEnv("USGS_SYNC_FEED", "2.5_day"),
		HTTPTimeout:          45 * time.Second,
	}
}

func getEnv(key, fallback string) string {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallback
	}
	return value
}

func getEnvInt(key string, fallback int) int {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallback
	}
	parsed, err := strconv.Atoi(value)
	if err != nil {
		return fallback
	}
	return parsed
}

func getEnvFloat(key string, fallback float64) float64 {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallback
	}
	parsed, err := strconv.ParseFloat(value, 64)
	if err != nil {
		return fallback
	}
	return parsed
}

func splitCSV(value string) []string {
	parts := strings.Split(value, ",")
	result := make([]string, 0, len(parts))
	for _, part := range parts {
		part = strings.TrimSpace(part)
		if part != "" {
			result = append(result, part)
		}
	}
	if len(result) == 0 {
		return []string{"http://localhost:3000"}
	}
	return result
}
