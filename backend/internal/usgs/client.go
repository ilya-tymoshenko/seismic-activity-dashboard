package usgs

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"time"

	"earthquake-big-data/backend/internal/models"
)

const queryEndpoint = "https://earthquake.usgs.gov/fdsnws/event/1/query"

var feedURLs = map[string]string{
	"all_day":   "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson",
	"2.5_day":   "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson",
	"all_month": "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_month.geojson",
	"2.5_month": "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_month.geojson",
}

type Client struct {
	httpClient *http.Client
}

func NewClient(timeout time.Duration) *Client {
	return &Client{
		httpClient: &http.Client{Timeout: timeout},
	}
}

func FeedURL(feed string) (string, bool) {
	value, ok := feedURLs[feed]
	return value, ok
}

func (c *Client) FetchFeed(ctx context.Context, feed string) (models.USGSFeatureCollection, error) {
	feedURL, ok := FeedURL(feed)
	if !ok {
		return models.USGSFeatureCollection{}, fmt.Errorf("unsupported feed %q", feed)
	}
	return c.fetch(ctx, feedURL)
}

func (c *Client) FetchHistoryChunk(ctx context.Context, start time.Time, end time.Time, minMagnitude float64) (models.USGSFeatureCollection, error) {
	params := url.Values{}
	params.Set("format", "geojson")
	params.Set("starttime", start.UTC().Format("2006-01-02T15:04:05"))
	params.Set("endtime", end.UTC().Format("2006-01-02T15:04:05"))
	params.Set("minmagnitude", fmt.Sprintf("%.2f", minMagnitude))
	params.Set("orderby", "time-asc")

	return c.fetch(ctx, queryEndpoint+"?"+params.Encode())
}

func (c *Client) fetch(ctx context.Context, rawURL string) (models.USGSFeatureCollection, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, rawURL, nil)
	if err != nil {
		return models.USGSFeatureCollection{}, err
	}
	req.Header.Set("Accept", "application/geo+json, application/json")
	req.Header.Set("User-Agent", "earthquake-big-data-dashboard/0.1")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return models.USGSFeatureCollection{}, err
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		return models.USGSFeatureCollection{}, fmt.Errorf("USGS returned HTTP %d for %s", resp.StatusCode, rawURL)
	}

	var collection models.USGSFeatureCollection
	if err := json.NewDecoder(resp.Body).Decode(&collection); err != nil {
		return models.USGSFeatureCollection{}, err
	}
	if collection.Type != "FeatureCollection" {
		return models.USGSFeatureCollection{}, fmt.Errorf("unexpected USGS response type %q", collection.Type)
	}
	return collection, nil
}
