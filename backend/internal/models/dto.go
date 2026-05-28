package models

import "time"

type Filters struct {
	DateFrom     *time.Time
	DateTo       *time.Time
	MinMagnitude *float64
	MaxMagnitude *float64
	MinDepth     *float64
	MaxDepth     *float64
	Tsunami      *int
	Alert        string
	Type         string
	BBox         *BBox
	Limit        int
}

type BBox struct {
	MinLon float64
	MinLat float64
	MaxLon float64
	MaxLat float64
}

type EarthquakesResponse struct {
	Data []Earthquake `json:"data"`
	Meta Meta         `json:"meta"`
}

type Meta struct {
	Limit    int `json:"limit"`
	Returned int `json:"returned"`
}

type StrongestEvent struct {
	ID        string     `json:"id"`
	Time      *time.Time `json:"time"`
	Magnitude *float64   `json:"magnitude"`
	Place     string     `json:"place"`
}

type StatsResponse struct {
	TotalEvents    int64           `json:"totalEvents"`
	MaxMagnitude   *float64        `json:"maxMagnitude"`
	AvgMagnitude   *float64        `json:"avgMagnitude"`
	AvgDepth       *float64        `json:"avgDepth"`
	TsunamiEvents  int64           `json:"tsunamiEvents"`
	EventsLast24h  int64           `json:"eventsLast24h"`
	EventsLast7d   int64           `json:"eventsLast7d"`
	StrongestEvent *StrongestEvent `json:"strongestEvent"`
}

type DailyActivity struct {
	Date         string   `json:"date"`
	Count        int64    `json:"count"`
	AvgMagnitude *float64 `json:"avgMagnitude"`
}

type CategoryCount struct {
	Category string `json:"category"`
	Count    int64  `json:"count"`
}

type TopPlace struct {
	Place        string   `json:"place"`
	Count        int64    `json:"count"`
	MaxMagnitude *float64 `json:"maxMagnitude"`
}

type AnalyticsResponse struct {
	EventsByDay           []DailyActivity `json:"eventsByDay"`
	MagnitudeDistribution []CategoryCount `json:"magnitudeDistribution"`
	DepthDistribution     []CategoryCount `json:"depthDistribution"`
	TopPlaces             []TopPlace      `json:"topPlaces"`
}

type ImportSummary struct {
	Source       string  `json:"source,omitempty"`
	Feed         string  `json:"feed,omitempty"`
	Days         int     `json:"days,omitempty"`
	MinMagnitude float64 `json:"minMagnitude,omitempty"`
	Chunks       int     `json:"chunks,omitempty"`
	Fetched      int     `json:"fetched"`
	Processed    int     `json:"processed"`
	Skipped      int     `json:"skipped"`
	Errors       int     `json:"errors"`
}
