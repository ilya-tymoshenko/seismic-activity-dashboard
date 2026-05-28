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

type ProgressCallback func(models.ImportProgressUpdate)

func NewImporter(client *Client, repo *repository.EarthquakeRepository) *Importer {
	return &Importer{client: client, repo: repo}
}

func (i *Importer) SyncFeed(ctx context.Context, feed string) (models.ImportSummary, error) {
	return i.SyncFeedWithProgress(ctx, feed, nil)
}

func (i *Importer) SyncFeedWithProgress(ctx context.Context, feed string, progress ProgressCallback) (models.ImportSummary, error) {
	report(progress, models.ImportProgressUpdate{
		Progress: 0,
		Message:  "Waiting for importer",
	})

	i.mu.Lock()
	defer i.mu.Unlock()

	report(progress, models.ImportProgressUpdate{
		Progress: 5,
		Message:  "Fetching recent USGS feed",
	})

	collection, err := i.client.FetchFeed(ctx, feed)
	if err != nil {
		return models.ImportSummary{}, err
	}

	total := len(collection.Features)
	report(progress, models.ImportProgressUpdate{
		Progress:    progressForSync(0, total),
		Message:     fmt.Sprintf("Fetched %d events from %s", total, feed),
		CurrentStep: 0,
		TotalSteps:  total,
		Summary: models.ImportSummary{
			Source:  "USGS",
			Feed:    feed,
			Fetched: total,
		},
	})

	summary := i.processCollection(ctx, collection, func(done int, total int, partial models.ImportSummary) {
		partial.Source = "USGS"
		partial.Feed = feed
		report(progress, models.ImportProgressUpdate{
			Progress:    progressForSync(done, total),
			Message:     fmt.Sprintf("Processing recent feed: %d/%d events", done, total),
			CurrentStep: done,
			TotalSteps:  total,
			Summary:     partial,
		})
	})
	summary.Source = "USGS"
	summary.Feed = feed
	report(progress, models.ImportProgressUpdate{
		Progress:    100,
		Message:     "Sync complete",
		CurrentStep: total,
		TotalSteps:  total,
		Summary:     summary,
	})
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
	return i.ImportHistoryWithProgress(ctx, days, minMagnitude, chunkDays, nil)
}

func (i *Importer) ImportHistoryWithProgress(ctx context.Context, days int, minMagnitude float64, chunkDays int, progress ProgressCallback) (models.ImportSummary, error) {
	report(progress, models.ImportProgressUpdate{
		Progress: 0,
		Message:  "Waiting for importer",
	})

	i.mu.Lock()
	defer i.mu.Unlock()

	if days <= 0 {
		days = 365
	}

	now := time.Now().UTC()
	start := now.AddDate(0, 0, -days)
	return i.importRange(ctx, start, now, minMagnitude, chunkDays, progress)
}

func (i *Importer) ImportRange(ctx context.Context, start time.Time, end time.Time, minMagnitude float64, chunkDays int) (models.ImportSummary, error) {
	i.mu.Lock()
	defer i.mu.Unlock()

	return i.importRange(ctx, start, end, minMagnitude, chunkDays, nil)
}

func (i *Importer) importRange(ctx context.Context, start time.Time, end time.Time, minMagnitude float64, chunkDays int, progress ProgressCallback) (models.ImportSummary, error) {
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
	totalChunks := countRangeChunks(start, end, chunkDays)

	summary := models.ImportSummary{
		Source:       "USGS",
		Feed:         "history",
		Days:         totalDays,
		MinMagnitude: minMagnitude,
	}
	report(progress, models.ImportProgressUpdate{
		Progress:    0,
		Message:     fmt.Sprintf("Importing %d days of history", totalDays),
		CurrentStep: 0,
		TotalSteps:  totalChunks,
		Summary:     summary,
	})

	for chunkStart := start; chunkStart.Before(end); {
		chunkIndex := summary.Chunks
		chunkEnd := chunkStart.AddDate(0, 0, chunkDays)
		if chunkEnd.After(end) {
			chunkEnd = end
		}
		summary.Chunks++
		report(progress, models.ImportProgressUpdate{
			Progress:    progressForHistory(chunkIndex, 0, 0, totalChunks),
			Message:     fmt.Sprintf("Fetching chunk %d/%d: %s..%s", summary.Chunks, totalChunks, chunkStart.Format("2006-01-02"), chunkEnd.Format("2006-01-02")),
			CurrentStep: summary.Chunks,
			TotalSteps:  totalChunks,
			Summary:     summary,
		})

		collection, err := i.client.FetchHistoryChunk(ctx, chunkStart, chunkEnd, minMagnitude)
		if err != nil {
			summary.Errors++
			report(progress, models.ImportProgressUpdate{
				Progress:    progressForHistory(chunkIndex, 0, 0, totalChunks),
				Message:     fmt.Sprintf("Failed chunk %d/%d", summary.Chunks, totalChunks),
				CurrentStep: summary.Chunks,
				TotalSteps:  totalChunks,
				Summary:     summary,
			})
			return summary, fmt.Errorf("fetch history chunk %s..%s: %w", chunkStart.Format("2006-01-02"), chunkEnd.Format("2006-01-02"), err)
		}

		chunkSummary := i.processCollection(ctx, collection, func(done int, total int, partial models.ImportSummary) {
			combined := summary
			combined.Fetched += partial.Fetched
			combined.Processed += partial.Processed
			combined.Skipped += partial.Skipped
			combined.Errors += partial.Errors
			report(progress, models.ImportProgressUpdate{
				Progress:    progressForHistory(chunkIndex, done, total, totalChunks),
				Message:     fmt.Sprintf("Processing chunk %d/%d: %d/%d events", summary.Chunks, totalChunks, done, total),
				CurrentStep: summary.Chunks,
				TotalSteps:  totalChunks,
				Summary:     combined,
			})
		})
		summary.Fetched += chunkSummary.Fetched
		summary.Processed += chunkSummary.Processed
		summary.Skipped += chunkSummary.Skipped
		summary.Errors += chunkSummary.Errors
		report(progress, models.ImportProgressUpdate{
			Progress:    progressForHistory(summary.Chunks, 0, 0, totalChunks),
			Message:     fmt.Sprintf("Completed chunk %d/%d", summary.Chunks, totalChunks),
			CurrentStep: summary.Chunks,
			TotalSteps:  totalChunks,
			Summary:     summary,
		})

		chunkStart = chunkEnd
		if chunkStart.Before(end) {
			select {
			case <-ctx.Done():
				return summary, ctx.Err()
			case <-time.After(300 * time.Millisecond):
			}
		}
	}

	report(progress, models.ImportProgressUpdate{
		Progress:    100,
		Message:     "History import complete",
		CurrentStep: totalChunks,
		TotalSteps:  totalChunks,
		Summary:     summary,
	})
	return summary, nil
}

func (i *Importer) ProcessCollection(ctx context.Context, collection models.USGSFeatureCollection) models.ImportSummary {
	return i.processCollection(ctx, collection, nil)
}

func (i *Importer) processCollection(ctx context.Context, collection models.USGSFeatureCollection, progress func(done int, total int, summary models.ImportSummary)) models.ImportSummary {
	summary := models.ImportSummary{
		Fetched: len(collection.Features),
	}
	total := len(collection.Features)
	if total == 0 {
		reportCollectionProgress(progress, 0, total, summary)
		return summary
	}
	for index, feature := range collection.Features {
		if err := ctx.Err(); err != nil {
			summary.Errors++
			reportCollectionProgress(progress, index+1, total, summary)
			return summary
		}
		i.processFeature(ctx, feature, &summary)
		done := index + 1
		if shouldReportCollectionProgress(done, total) {
			reportCollectionProgress(progress, done, total, summary)
		}
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

func report(progress ProgressCallback, update models.ImportProgressUpdate) {
	if progress != nil {
		progress(update)
	}
}

func reportCollectionProgress(progress func(done int, total int, summary models.ImportSummary), done int, total int, summary models.ImportSummary) {
	if progress != nil {
		progress(done, total, summary)
	}
}

func shouldReportCollectionProgress(done int, total int) bool {
	return done == 1 || done == total || done%100 == 0
}

func progressForSync(done int, total int) float64 {
	if total <= 0 {
		return 100
	}
	return 10 + (float64(done)/float64(total))*90
}

func progressForHistory(completedChunks int, doneInChunk int, totalInChunk int, totalChunks int) float64 {
	if totalChunks <= 0 {
		return 100
	}
	chunkProgress := 0.0
	if totalInChunk > 0 {
		chunkProgress = float64(doneInChunk) / float64(totalInChunk)
	}
	progress := (float64(completedChunks) + chunkProgress) / float64(totalChunks) * 100
	if progress > 100 {
		return 100
	}
	if progress < 0 {
		return 0
	}
	return progress
}

func countRangeChunks(start time.Time, end time.Time, chunkDays int) int {
	chunks := 0
	for chunkStart := start; chunkStart.Before(end); {
		chunkEnd := chunkStart.AddDate(0, 0, chunkDays)
		if chunkEnd.After(end) {
			chunkEnd = end
		}
		chunks++
		chunkStart = chunkEnd
	}
	return chunks
}
