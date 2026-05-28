package config

import (
	"os"
	"strconv"
	"strings"
	"time"
)

type Config struct {
	AppPort               string
	DatabaseURL           string
	CORSAllowedOrigins    []string
	USGSMinMagnitude      float64
	USGSHistoryDays       int
	USGSHistoryChunkDays  int
	USGSSyncFeed          string
	USGSSyncEnabled       bool
	USGSSyncInterval      time.Duration
	USGSSeedImportEnabled bool
	USGSSeedFile          string
	HTTPTimeout           time.Duration
}

func Load() Config {
	minMagnitude := getEnvFloat("USGS_MIN_MAGNITUDE", 2.5)
	return Config{
		AppPort:               getEnv("APP_PORT", "8080"),
		DatabaseURL:           getEnv("DATABASE_URL", "postgres://postgres:postgres@localhost:5432/earthquakes?sslmode=disable"),
		CORSAllowedOrigins:    splitCSV(getEnv("CORS_ALLOWED_ORIGINS", "http://localhost:3000")),
		USGSMinMagnitude:      minMagnitude,
		USGSHistoryDays:       getEnvInt("USGS_HISTORY_DAYS", 3650),
		USGSHistoryChunkDays:  getEnvInt("USGS_HISTORY_CHUNK_DAYS", 30),
		USGSSyncFeed:          getEnv("USGS_SYNC_FEED", "2.5_day"),
		USGSSyncEnabled:       getEnvBool("USGS_SYNC_ENABLED", true),
		USGSSyncInterval:      getEnvDuration("USGS_SYNC_INTERVAL", time.Hour),
		USGSSeedImportEnabled: getEnvBool("USGS_SEED_IMPORT_ENABLED", true),
		USGSSeedFile:          getEnv("USGS_SEED_FILE", "/data/usgs_seed.geojson"),
		HTTPTimeout:           45 * time.Second,
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

func getEnvBool(key string, fallback bool) bool {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallback
	}
	parsed, err := strconv.ParseBool(value)
	if err != nil {
		return fallback
	}
	return parsed
}

func getEnvDuration(key string, fallback time.Duration) time.Duration {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallback
	}
	parsed, err := time.ParseDuration(value)
	if err == nil && parsed > 0 {
		return parsed
	}
	if seconds, err := strconv.Atoi(value); err == nil && seconds > 0 {
		return time.Duration(seconds) * time.Second
	}
	return fallback
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
