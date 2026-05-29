package usgs

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"earthquake-big-data/backend/internal/models"
)

const (
	countEndpoint = "https://earthquake.usgs.gov/fdsnws/event/1/count"
	queryEndpoint = "https://earthquake.usgs.gov/fdsnws/event/1/query"
)

var feedURLs = map[string]string{
	"all_day":   "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson",
	"2.5_day":   "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson",
	"all_month": "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_month.geojson",
	"2.5_month": "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_month.geojson",
}

type Client struct {
	httpClient *http.Client
}

type QueryFilters struct {
	StartTime    time.Time
	EndTime      time.Time
	MinMagnitude *float64
	MaxMagnitude *float64
	MinDepth     *float64
	MaxDepth     *float64
	BBox         *models.BBox
	Alert        string
	EventType    string
	Tsunami      *int
}

type QueryRange struct {
	Filters       QueryFilters
	ExpectedCount int
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
	filters := QueryFilters{
		StartTime:    start,
		EndTime:      end,
		MinMagnitude: &minMagnitude,
	}
	return c.FetchQuery(ctx, filters, 0)
}

func (c *Client) CountQuery(ctx context.Context, filters QueryFilters) (int, error) {
	params := queryParams(filters)
	payload, err := c.fetchBytes(ctx, countEndpoint+"?"+params.Encode())
	if err != nil {
		return 0, err
	}
	rawCount := strings.TrimSpace(string(payload))
	count, err := strconv.Atoi(rawCount)
	if err != nil {
		return 0, fmt.Errorf("parse USGS count %q: %w", rawCount, err)
	}
	return count, nil
}

func (c *Client) FetchQuery(ctx context.Context, filters QueryFilters, limit int) (models.USGSFeatureCollection, error) {
	params := queryParams(filters)
	params.Set("format", "geojson")
	params.Set("orderby", "time-asc")
	if limit > 0 {
		params.Set("limit", strconv.Itoa(limit))
	}
	return c.fetch(ctx, queryEndpoint+"?"+params.Encode())
}

func (c *Client) SplitQueryRange(ctx context.Context, filters QueryFilters, maxPerRequest int) ([]QueryRange, error) {
	count, err := c.CountQuery(ctx, filters)
	if err != nil {
		return nil, err
	}
	if count <= maxPerRequest {
		return []QueryRange{{Filters: filters, ExpectedCount: count}}, nil
	}

	midpoint := filters.StartTime.Add(filters.EndTime.Sub(filters.StartTime) / 2)
	if !midpoint.After(filters.StartTime) || !midpoint.Before(filters.EndTime) {
		return nil, fmt.Errorf("cannot split USGS range %s..%s with %d events", formatUSGSTime(filters.StartTime), formatUSGSTime(filters.EndTime), count)
	}

	left := filters
	left.EndTime = midpoint
	right := filters
	right.StartTime = midpoint

	leftRanges, err := c.SplitQueryRange(ctx, left, maxPerRequest)
	if err != nil {
		return nil, err
	}
	rightRanges, err := c.SplitQueryRange(ctx, right, maxPerRequest)
	if err != nil {
		return nil, err
	}
	return append(leftRanges, rightRanges...), nil
}

func (c *Client) fetch(ctx context.Context, rawURL string) (models.USGSFeatureCollection, error) {
	payload, err := c.fetchBytes(ctx, rawURL)
	if err != nil {
		return models.USGSFeatureCollection{}, err
	}

	var collection models.USGSFeatureCollection
	if err := json.Unmarshal(payload, &collection); err != nil {
		return models.USGSFeatureCollection{}, err
	}
	if collection.Type != "FeatureCollection" {
		return models.USGSFeatureCollection{}, fmt.Errorf("unexpected USGS response type %q", collection.Type)
	}
	return collection, nil
}

func (c *Client) fetchBytes(ctx context.Context, rawURL string) ([]byte, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, rawURL, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/geo+json, application/json")
	req.Header.Set("User-Agent", "earthquake-big-data-dashboard/0.1")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		return nil, fmt.Errorf("USGS returned HTTP %d for %s", resp.StatusCode, rawURL)
	}

	return io.ReadAll(resp.Body)
}

func queryParams(filters QueryFilters) url.Values {
	params := url.Values{}
	params.Set("starttime", formatUSGSTime(filters.StartTime))
	params.Set("endtime", formatUSGSTime(filters.EndTime))
	if filters.MinMagnitude != nil {
		params.Set("minmagnitude", formatUSGSFloat(*filters.MinMagnitude))
	}
	if filters.MaxMagnitude != nil {
		params.Set("maxmagnitude", formatUSGSFloat(*filters.MaxMagnitude))
	}
	if filters.MinDepth != nil {
		params.Set("mindepth", formatUSGSFloat(*filters.MinDepth))
	}
	if filters.MaxDepth != nil {
		params.Set("maxdepth", formatUSGSFloat(*filters.MaxDepth))
	}
	if filters.BBox != nil {
		params.Set("minlongitude", formatUSGSFloat(filters.BBox.MinLon))
		params.Set("minlatitude", formatUSGSFloat(filters.BBox.MinLat))
		params.Set("maxlongitude", formatUSGSFloat(filters.BBox.MaxLon))
		params.Set("maxlatitude", formatUSGSFloat(filters.BBox.MaxLat))
	}
	if filters.Alert != "" && filters.Alert != "none" {
		params.Set("alertlevel", filters.Alert)
	}
	if filters.EventType != "" {
		params.Set("eventtype", filters.EventType)
	}
	return params
}

func formatUSGSTime(value time.Time) string {
	return value.UTC().Format("2006-01-02T15:04:05")
}

func formatUSGSFloat(value float64) string {
	return strconv.FormatFloat(value, 'f', -1, 64)
}
