package main

import (
	"context"
	"encoding/json"
	"flag"
	"log"
	"os"

	"earthquake-big-data/backend/internal/config"
	dbconn "earthquake-big-data/backend/internal/db"
	"earthquake-big-data/backend/internal/repository"
	"earthquake-big-data/backend/internal/usgs"
)

func main() {
	cfg := config.Load()

	days := flag.Int("days", cfg.USGSHistoryDays, "number of days to import")
	minMagnitude := flag.Float64("minMagnitude", cfg.USGSMinMagnitude, "minimum magnitude")
	chunkDays := flag.Int("chunkDays", cfg.USGSHistoryChunkDays, "history query chunk size in days")
	flag.Parse()

	_, sqlDB, err := dbconn.Connect(cfg)
	if err != nil {
		log.Fatalf("database connection failed: %v", err)
	}
	defer sqlDB.Close()

	repo := repository.NewEarthquakeRepository(sqlDB)
	client := usgs.NewClient(cfg.HTTPTimeout)
	importer := usgs.NewImporter(client, repo)

	summary, err := importer.ImportHistory(context.Background(), *days, *minMagnitude, *chunkDays)
	if err != nil {
		log.Printf("history import failed: %v", err)
	}

	encoder := json.NewEncoder(os.Stdout)
	encoder.SetIndent("", "  ")
	if encodeErr := encoder.Encode(summary); encodeErr != nil {
		log.Fatalf("encode summary: %v", encodeErr)
	}
	if err != nil {
		os.Exit(1)
	}
}
