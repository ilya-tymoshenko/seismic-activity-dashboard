package usgs

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"sync"
	"time"

	"earthquake-big-data/backend/internal/models"
	"earthquake-big-data/backend/internal/repository"
)

type Importer struct {
	client *Client
	repo   *repository.EarthquakeRepository
	mu     sync.Mutex
}

func NewImporter(client *Client, repo *repository.EarthquakeRepository) *Importer {
	return &Importer{client: client, repo: repo}
}

func (i *Importer) SyncFeed(ctx context.Context, feed string) (models.ImportSummary, error) {
	i.mu.Lock()
	defer i.mu.Unlock()

	collection, err := i.client.FetchFeed(ctx, feed)
	if err != nil {
		return models.ImportSummary{}, err
	}

	summary := i.ProcessCollection(ctx, collection)
	summary.Source = "USGS"
	summary.Feed = feed
	return summary, nil
}

func (i *Importer) ImportFile(ctx context.Context, path string) (models.ImportSummary, error) {
	i.mu.Lock()
	defer i.mu.Unlock()

	file, err := os.Open(path)
	if err != nil {
		return models.ImportSummary{}, fmt.Errorf("open seed file %s: %w", path, err)
	}
	defer file.Close()

	summary, err := i.processFeatureCollectionStream(ctx, json.NewDecoder(file))
	if err != nil {
		return summary, fmt.Errorf("decode seed file %s: %w", path, err)
	}
	summary.Source = "USGS"
	summary.Feed = path
	return summary, nil
}

func (i *Importer) ImportHistory(ctx context.Context, days int, minMagnitude float64, chunkDays int) (models.ImportSummary, error) {
	i.mu.Lock()
	defer i.mu.Unlock()

	if days <= 0 {
		days = 365
	}

	now := time.Now().UTC()
	start := now.AddDate(0, 0, -days)
	return i.importRange(ctx, start, now, minMagnitude, chunkDays)
}

func (i *Importer) ImportRange(ctx context.Context, start time.Time, end time.Time, minMagnitude float64, chunkDays int) (models.ImportSummary, error) {
	i.mu.Lock()
	defer i.mu.Unlock()

	return i.importRange(ctx, start, end, minMagnitude, chunkDays)
}

func (i *Importer) importRange(ctx context.Context, start time.Time, end time.Time, minMagnitude float64, chunkDays int) (models.ImportSummary, error) {
	start = start.UTC()
	end = end.UTC()
	if !start.Before(end) {
		return models.ImportSummary{MinMagnitude: minMagnitude}, nil
	}
	if chunkDays <= 0 {
		chunkDays = 30
	}
	totalDays := int(end.Sub(start).Hours() / 24)
	if totalDays <= 0 {
		totalDays = 1
	}
	if chunkDays > totalDays {
		chunkDays = totalDays
	}

	summary := models.ImportSummary{
		Days:         totalDays,
		MinMagnitude: minMagnitude,
	}

	for chunkStart := start; chunkStart.Before(end); {
		chunkEnd := chunkStart.AddDate(0, 0, chunkDays)
		if chunkEnd.After(end) {
			chunkEnd = end
		}
		summary.Chunks++

		collection, err := i.client.FetchHistoryChunk(ctx, chunkStart, chunkEnd, minMagnitude)
		if err != nil {
			summary.Errors++
			return summary, fmt.Errorf("fetch history chunk %s..%s: %w", chunkStart.Format("2006-01-02"), chunkEnd.Format("2006-01-02"), err)
		}

		chunkSummary := i.ProcessCollection(ctx, collection)
		summary.Fetched += chunkSummary.Fetched
		summary.Processed += chunkSummary.Processed
		summary.Skipped += chunkSummary.Skipped
		summary.Errors += chunkSummary.Errors

		chunkStart = chunkEnd
		if chunkStart.Before(end) {
			select {
			case <-ctx.Done():
				return summary, ctx.Err()
			case <-time.After(300 * time.Millisecond):
			}
		}
	}

	return summary, nil
}

func (i *Importer) ProcessCollection(ctx context.Context, collection models.USGSFeatureCollection) models.ImportSummary {
	summary := models.ImportSummary{
		Fetched: len(collection.Features),
	}
	for _, feature := range collection.Features {
		if err := ctx.Err(); err != nil {
			summary.Errors++
			return summary
		}
		i.processFeature(ctx, feature, &summary)
	}
	return summary
}

func (i *Importer) processFeatureCollectionStream(ctx context.Context, decoder *json.Decoder) (models.ImportSummary, error) {
	var summary models.ImportSummary
	token, err := decoder.Token()
	if err != nil {
		return summary, err
	}
	if delimiter, ok := token.(json.Delim); !ok || delimiter != '{' {
		return summary, fmt.Errorf("expected GeoJSON object")
	}

	featureCollection := false
	featuresSeen := false
	for decoder.More() {
		token, err = decoder.Token()
		if err != nil {
			return summary, err
		}
		key, ok := token.(string)
		if !ok {
			return summary, fmt.Errorf("expected object key")
		}

		switch key {
		case "type":
			var collectionType string
			if err := decoder.Decode(&collectionType); err != nil {
				return summary, err
			}
			if collectionType != "FeatureCollection" {
				return summary, fmt.Errorf("unexpected seed file type %q", collectionType)
			}
			featureCollection = true
		case "features":
			if err := i.processFeatureArray(ctx, decoder, &summary); err != nil {
				return summary, err
			}
			featuresSeen = true
		default:
			var discard json.RawMessage
			if err := decoder.Decode(&discard); err != nil {
				return summary, err
			}
		}
	}
	if _, err := decoder.Token(); err != nil {
		return summary, err
	}
	if !featureCollection {
		return summary, fmt.Errorf("missing GeoJSON FeatureCollection type")
	}
	if !featuresSeen {
		return summary, fmt.Errorf("missing GeoJSON features array")
	}
	return summary, nil
}

func (i *Importer) processFeatureArray(ctx context.Context, decoder *json.Decoder, summary *models.ImportSummary) error {
	token, err := decoder.Token()
	if err != nil {
		return err
	}
	if delimiter, ok := token.(json.Delim); !ok || delimiter != '[' {
		return fmt.Errorf("expected features array")
	}

	for decoder.More() {
		if err := ctx.Err(); err != nil {
			summary.Errors++
			return err
		}
		var feature models.USGSFeature
		if err := decoder.Decode(&feature); err != nil {
			summary.Errors++
			return err
		}
		summary.Fetched++
		i.processFeature(ctx, feature, summary)
	}
	_, err = decoder.Token()
	return err
}

func (i *Importer) processFeature(ctx context.Context, feature models.USGSFeature, summary *models.ImportSummary) {
	processed, skipped, err := i.repo.UpsertUSGSFeature(ctx, feature)
	if err != nil {
		summary.Errors++
		return
	}
	if skipped {
		summary.Skipped++
		return
	}
	if processed {
		summary.Processed++
	}
}
