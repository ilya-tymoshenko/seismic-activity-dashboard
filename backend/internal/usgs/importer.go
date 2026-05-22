package usgs

import (
	"context"
	"fmt"
	"time"

	"earthquake-big-data/backend/internal/models"
	"earthquake-big-data/backend/internal/repository"
)

type Importer struct {
	client *Client
	repo   *repository.EarthquakeRepository
}

func NewImporter(client *Client, repo *repository.EarthquakeRepository) *Importer {
	return &Importer{client: client, repo: repo}
}

func (i *Importer) SyncFeed(ctx context.Context, feed string) (models.ImportSummary, error) {
	collection, err := i.client.FetchFeed(ctx, feed)
	if err != nil {
		return models.ImportSummary{}, err
	}

	summary := i.ProcessCollection(ctx, collection)
	summary.Source = "USGS"
	summary.Feed = feed
	return summary, nil
}

func (i *Importer) ImportHistory(ctx context.Context, days int, minMagnitude float64, chunkDays int) (models.ImportSummary, error) {
	if days <= 0 {
		days = 365
	}
	if chunkDays <= 0 {
		chunkDays = 30
	}
	if chunkDays > days {
		chunkDays = days
	}

	now := time.Now().UTC()
	start := now.AddDate(0, 0, -days)
	summary := models.ImportSummary{
		Days:         days,
		MinMagnitude: minMagnitude,
	}

	for chunkStart := start; chunkStart.Before(now); {
		chunkEnd := chunkStart.AddDate(0, 0, chunkDays)
		if chunkEnd.After(now) {
			chunkEnd = now
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
		if chunkStart.Before(now) {
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
		processed, skipped, err := i.repo.UpsertUSGSFeature(ctx, feature)
		if err != nil {
			summary.Errors++
			continue
		}
		if skipped {
			summary.Skipped++
			continue
		}
		if processed {
			summary.Processed++
		}
	}
	return summary
}
