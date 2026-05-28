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

type ImportProgressUpdate struct {
	Progress    float64       `json:"progress"`
	Message     string        `json:"message"`
	CurrentStep int           `json:"currentStep"`
	TotalSteps  int           `json:"totalSteps"`
	Summary     ImportSummary `json:"summary"`
}

type ImportJobStatus struct {
	ID          string          `json:"id"`
	Kind        string          `json:"kind"`
	Label       string          `json:"label"`
	Status      string          `json:"status"`
	Message     string          `json:"message"`
	Params      ImportJobParams `json:"params"`
	Progress    float64         `json:"progress"`
	CurrentStep int             `json:"currentStep"`
	TotalSteps  int             `json:"totalSteps"`
	Summary     ImportSummary   `json:"summary"`
	Error       string          `json:"error,omitempty"`
	StartedAt   time.Time       `json:"startedAt"`
	FinishedAt  *time.Time      `json:"finishedAt,omitempty"`
}

type ImportJobStartResponse struct {
	JobID  string          `json:"jobId"`
	Status ImportJobStatus `json:"status"`
}

type ImportJobParams struct {
	Feed            string  `json:"feed,omitempty"`
	DateFrom        string  `json:"dateFrom,omitempty"`
	DateTo          string  `json:"dateTo,omitempty"`
	Days            int     `json:"days,omitempty"`
	MinMagnitude    float64 `json:"minMagnitude,omitempty"`
	HasMinMagnitude bool    `json:"-"`
	MaxMagnitude    float64 `json:"maxMagnitude,omitempty"`
	HasMaxMagnitude bool    `json:"-"`
	MinDepth        float64 `json:"minDepth,omitempty"`
	HasMinDepth     bool    `json:"-"`
	MaxDepth        float64 `json:"maxDepth,omitempty"`
	HasMaxDepth     bool    `json:"-"`
	ChunkDays       int     `json:"chunkDays,omitempty"`
	Alert           string  `json:"alert,omitempty"`
	Type            string  `json:"type,omitempty"`
	Tsunami         *int    `json:"tsunami,omitempty"`
	TsunamiOnly     bool    `json:"tsunamiOnly,omitempty"`
	BBoxMinLon      float64 `json:"bboxMinLon,omitempty"`
	BBoxMinLat      float64 `json:"bboxMinLat,omitempty"`
	BBoxMaxLon      float64 `json:"bboxMaxLon,omitempty"`
	BBoxMaxLat      float64 `json:"bboxMaxLat,omitempty"`
	HasBBox         bool    `json:"-"`
}
