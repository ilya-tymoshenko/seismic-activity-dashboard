package repository

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
	"time"

	"earthquake-big-data/backend/internal/models"
)

const (
	maxEarthquakeLimit = 5000
)

type EarthquakeRepository struct {
	db *sql.DB
}

func NewEarthquakeRepository(db *sql.DB) *EarthquakeRepository {
	return &EarthquakeRepository{db: db}
}

func (r *EarthquakeRepository) ImportState(ctx context.Context, key string) (string, bool, error) {
	var value string
	err := r.db.QueryRowContext(ctx, `SELECT value FROM import_state WHERE key = $1`, key).Scan(&value)
	if err == sql.ErrNoRows {
		return "", false, nil
	}
	if err != nil {
		return "", false, err
	}
	return value, true, nil
}

func (r *EarthquakeRepository) ImportStateWithUpdatedAt(ctx context.Context, key string) (string, time.Time, bool, error) {
	var value string
	var updatedAt time.Time
	err := r.db.QueryRowContext(ctx, `SELECT value, updated_at FROM import_state WHERE key = $1`, key).Scan(&value, &updatedAt)
	if err == sql.ErrNoRows {
		return "", time.Time{}, false, nil
	}
	if err != nil {
		return "", time.Time{}, false, err
	}
	return value, updatedAt.UTC(), true, nil
}

func (r *EarthquakeRepository) SetImportState(ctx context.Context, key string, value string) error {
	_, err := r.db.ExecContext(
		ctx,
		`
INSERT INTO import_state (key, value, updated_at)
VALUES ($1, $2, NOW())
ON CONFLICT (key) DO UPDATE SET
    value = EXCLUDED.value,
    updated_at = NOW()`,
		key,
		value,
	)
	return err
}

func (r *EarthquakeRepository) RefreshBIMaterializedViews(ctx context.Context) error {
	_, err := r.db.ExecContext(ctx, `SELECT refresh_bi_materialized_views()`)
	return err
}

func (r *EarthquakeRepository) EventInventory(ctx context.Context) (int64, *time.Time, *time.Time, error) {
	var total int64
	var oldest, newest sql.NullTime
	err := r.db.QueryRowContext(ctx, `SELECT COUNT(*), MIN(time), MAX(time) FROM earthquakes`).Scan(&total, &oldest, &newest)
	if err != nil {
		return 0, nil, nil, err
	}

	var oldestTime *time.Time
	if oldest.Valid {
		value := oldest.Time.UTC()
		oldestTime = &value
	}
	var newestTime *time.Time
	if newest.Valid {
		value := newest.Time.UTC()
		newestTime = &value
	}
	return total, oldestTime, newestTime, nil
}

func (r *EarthquakeRepository) UpsertUSGSFeature(ctx context.Context, feature models.USGSFeature) (bool, bool, error) {
	if strings.TrimSpace(feature.ID) == "" {
		return false, true, nil
	}
	if len(feature.Geometry.Coordinates) < 2 {
		return false, true, nil
	}

	longitude := feature.Geometry.Coordinates[0]
	latitude := feature.Geometry.Coordinates[1]
	if longitude < -180 || longitude > 180 || latitude < -90 || latitude > 90 {
		return false, true, nil
	}

	var depth *float64
	if len(feature.Geometry.Coordinates) >= 3 {
		value := feature.Geometry.Coordinates[2]
		depth = &value
	}

	rawJSON, err := json.Marshal(feature)
	if err != nil {
		return false, false, fmt.Errorf("marshal raw feature %s: %w", feature.ID, err)
	}

	eventTime := time.UnixMilli(feature.Properties.Time).UTC()
	updatedTime := time.UnixMilli(feature.Properties.Updated).UTC()

	const query = `
INSERT INTO earthquakes (
    id,
    time,
    updated,
    latitude,
    longitude,
    depth,
    magnitude,
    mag_type,
    place,
    alert,
    tsunami,
    sig,
    type,
    source,
    geom,
    raw_json,
    ingested_at
)
VALUES (
    $1, $2, $3,
    $4, $5, $6, $7,
    $8, $9, $10,
    $11, $12, $13,
    'USGS',
    ST_SetSRID(ST_MakePoint($5, $4), 4326),
    $14::jsonb,
    NOW()
)
ON CONFLICT (id) DO UPDATE SET
    time = EXCLUDED.time,
    updated = EXCLUDED.updated,
    latitude = EXCLUDED.latitude,
    longitude = EXCLUDED.longitude,
    depth = EXCLUDED.depth,
    magnitude = EXCLUDED.magnitude,
    mag_type = EXCLUDED.mag_type,
    place = EXCLUDED.place,
    alert = EXCLUDED.alert,
    tsunami = EXCLUDED.tsunami,
    sig = EXCLUDED.sig,
    type = EXCLUDED.type,
    geom = EXCLUDED.geom,
    raw_json = EXCLUDED.raw_json,
    ingested_at = NOW()
WHERE earthquakes.updated <= EXCLUDED.updated`

	_, err = r.db.ExecContext(
		ctx,
		query,
		feature.ID,
		eventTime,
		updatedTime,
		latitude,
		longitude,
		depth,
		feature.Properties.Mag,
		feature.Properties.MagType,
		feature.Properties.Place,
		feature.Properties.Alert,
		feature.Properties.Tsunami,
		feature.Properties.Sig,
		feature.Properties.Type,
		string(rawJSON),
	)
	if err != nil {
		return false, false, fmt.Errorf("upsert earthquake %s: %w", feature.ID, err)
	}

	return true, false, nil
}

func (r *EarthquakeRepository) ListEarthquakes(ctx context.Context, filters models.Filters) ([]models.Earthquake, error) {
	limit := clampLimit(filters.Limit)
	where, args := buildWhere(filters, true)
	args = append(args, limit)
	limitPlaceholder := placeholder(len(args))

	query := `
SELECT id, time, updated, latitude, longitude, depth, magnitude, mag_type, place, alert, tsunami, sig, type, source, ingested_at
FROM earthquakes
` + where + `
ORDER BY time DESC
LIMIT ` + limitPlaceholder

	rows, err := r.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	result := make([]models.Earthquake, 0, limit)
	for rows.Next() {
		item, err := scanEarthquake(rows)
		if err != nil {
			return nil, err
		}
		result = append(result, item)
	}
	return result, rows.Err()
}

func (r *EarthquakeRepository) Stats(ctx context.Context, filters models.Filters) (models.StatsResponse, error) {
	where, args := buildWhere(filters, true)
	query := `
SELECT
    COUNT(*) AS total_events,
    MAX(magnitude) AS max_magnitude,
    AVG(magnitude) AS avg_magnitude,
    AVG(depth) AS avg_depth,
    COUNT(*) FILTER (WHERE tsunami = 1) AS tsunami_events
FROM earthquakes
` + where

	var total, tsunami int64
	var maxMag, avgMag, avgDepth sql.NullFloat64
	if err := r.db.QueryRowContext(ctx, query, args...).Scan(&total, &maxMag, &avgMag, &avgDepth, &tsunami); err != nil {
		return models.StatsResponse{}, err
	}

	last24, err := r.countSince(ctx, filters, 24*time.Hour)
	if err != nil {
		return models.StatsResponse{}, err
	}
	last7d, err := r.countSince(ctx, filters, 7*24*time.Hour)
	if err != nil {
		return models.StatsResponse{}, err
	}
	strongest, err := r.strongestEvent(ctx, filters)
	if err != nil {
		return models.StatsResponse{}, err
	}

	return models.StatsResponse{
		TotalEvents:    total,
		MaxMagnitude:   nullFloatPtr(maxMag),
		AvgMagnitude:   nullFloatPtr(avgMag),
		AvgDepth:       nullFloatPtr(avgDepth),
		TsunamiEvents:  tsunami,
		EventsLast24h:  last24,
		EventsLast7d:   last7d,
		StrongestEvent: strongest,
	}, nil
}

func (r *EarthquakeRepository) Analytics(ctx context.Context, filters models.Filters) (models.AnalyticsResponse, error) {
	where, args := buildWhere(filters, false)

	eventsByDay, err := r.eventsByDay(ctx, where, args)
	if err != nil {
		return models.AnalyticsResponse{}, err
	}
	magDistribution, err := r.magnitudeDistribution(ctx, where, args)
	if err != nil {
		return models.AnalyticsResponse{}, err
	}
	depthDistribution, err := r.depthDistribution(ctx, where, args)
	if err != nil {
		return models.AnalyticsResponse{}, err
	}
	topPlaces, err := r.topPlaces(ctx, where, args)
	if err != nil {
		return models.AnalyticsResponse{}, err
	}

	return models.AnalyticsResponse{
		EventsByDay:           eventsByDay,
		MagnitudeDistribution: magDistribution,
		DepthDistribution:     depthDistribution,
		TopPlaces:             topPlaces,
	}, nil
}

func (r *EarthquakeRepository) countSince(ctx context.Context, filters models.Filters, duration time.Duration) (int64, error) {
	where, args := buildWhere(filters, true)
	args = append(args, time.Now().UTC().Add(-duration))
	query := `SELECT COUNT(*) FROM earthquakes ` + where + ` AND time >= ` + placeholder(len(args))

	var count int64
	err := r.db.QueryRowContext(ctx, query, args...).Scan(&count)
	return count, err
}

func (r *EarthquakeRepository) strongestEvent(ctx context.Context, filters models.Filters) (*models.StrongestEvent, error) {
	where, args := buildWhere(filters, true)
	query := `
SELECT id, time, magnitude, place
FROM earthquakes
` + where + `
ORDER BY magnitude DESC NULLS LAST, time DESC
LIMIT 1`

	var event models.StrongestEvent
	var eventTime sql.NullTime
	var magnitude sql.NullFloat64
	err := r.db.QueryRowContext(ctx, query, args...).Scan(&event.ID, &eventTime, &magnitude, &event.Place)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if eventTime.Valid {
		event.Time = &eventTime.Time
	}
	event.Magnitude = nullFloatPtr(magnitude)
	return &event, nil
}

func (r *EarthquakeRepository) eventsByDay(ctx context.Context, where string, args []any) ([]models.DailyActivity, error) {
	query := `
WITH daily AS (
  SELECT DATE(time) AS eq_date, COUNT(*) AS count, AVG(magnitude) AS avg_magnitude
  FROM earthquakes
  ` + where + `
  GROUP BY DATE(time)
),
latest AS (
  SELECT eq_date, count, avg_magnitude
  FROM daily
  ORDER BY eq_date DESC
  LIMIT 366
)
SELECT eq_date::text AS date, count, avg_magnitude
FROM latest
ORDER BY eq_date ASC`

	rows, err := r.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	result := make([]models.DailyActivity, 0)
	for rows.Next() {
		var item models.DailyActivity
		var avg sql.NullFloat64
		if err := rows.Scan(&item.Date, &item.Count, &avg); err != nil {
			return nil, err
		}
		item.AvgMagnitude = nullFloatPtr(avg)
		result = append(result, item)
	}
	return result, rows.Err()
}

func (r *EarthquakeRepository) magnitudeDistribution(ctx context.Context, where string, args []any) ([]models.CategoryCount, error) {
	query := `
WITH categorized AS (
  SELECT
    CASE
      WHEN magnitude IS NULL THEN 'Unknown'
      WHEN magnitude < 3 THEN 'Minor'
      WHEN magnitude >= 3 AND magnitude < 5 THEN 'Light'
      WHEN magnitude >= 5 AND magnitude < 7 THEN 'Moderate'
      ELSE 'Severe'
    END AS category,
    CASE
      WHEN magnitude IS NULL THEN 5
      WHEN magnitude < 3 THEN 1
      WHEN magnitude >= 3 AND magnitude < 5 THEN 2
      WHEN magnitude >= 5 AND magnitude < 7 THEN 3
      ELSE 4
    END AS sort_order
  FROM earthquakes
  ` + where + `
)
SELECT category, COUNT(*) AS count
FROM categorized
GROUP BY category, sort_order
ORDER BY sort_order`

	return queryCategoryCounts(ctx, r.db, query, args)
}

func (r *EarthquakeRepository) depthDistribution(ctx context.Context, where string, args []any) ([]models.CategoryCount, error) {
	query := `
WITH categorized AS (
  SELECT
    CASE
      WHEN depth IS NULL THEN 'Unknown'
      WHEN depth < 70 THEN 'Shallow'
      WHEN depth >= 70 AND depth < 300 THEN 'Intermediate'
      ELSE 'Deep'
    END AS category,
    CASE
      WHEN depth IS NULL THEN 4
      WHEN depth < 70 THEN 1
      WHEN depth >= 70 AND depth < 300 THEN 2
      ELSE 3
    END AS sort_order
  FROM earthquakes
  ` + where + `
)
SELECT category, COUNT(*) AS count
FROM categorized
GROUP BY category, sort_order
ORDER BY sort_order`

	return queryCategoryCounts(ctx, r.db, query, args)
}

func (r *EarthquakeRepository) topPlaces(ctx context.Context, where string, args []any) ([]models.TopPlace, error) {
	query := `
SELECT COALESCE(NULLIF(place, ''), 'Unknown') AS place, COUNT(*) AS count, MAX(magnitude) AS max_magnitude
FROM earthquakes
` + where + `
GROUP BY COALESCE(NULLIF(place, ''), 'Unknown')
ORDER BY count DESC
LIMIT 10`

	rows, err := r.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	result := make([]models.TopPlace, 0, 10)
	for rows.Next() {
		var item models.TopPlace
		var maxMag sql.NullFloat64
		if err := rows.Scan(&item.Place, &item.Count, &maxMag); err != nil {
			return nil, err
		}
		item.MaxMagnitude = nullFloatPtr(maxMag)
		result = append(result, item)
	}
	return result, rows.Err()
}

func queryCategoryCounts(ctx context.Context, db *sql.DB, query string, args []any) ([]models.CategoryCount, error) {
	rows, err := db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	result := make([]models.CategoryCount, 0)
	for rows.Next() {
		var item models.CategoryCount
		if err := rows.Scan(&item.Category, &item.Count); err != nil {
			return nil, err
		}
		result = append(result, item)
	}
	return result, rows.Err()
}

type earthquakeScanner interface {
	Scan(dest ...any) error
}

func scanEarthquake(scanner earthquakeScanner) (models.Earthquake, error) {
	var item models.Earthquake
	var depth, magnitude sql.NullFloat64
	var magType, alert, source sql.NullString
	var ingested sql.NullTime

	err := scanner.Scan(
		&item.ID,
		&item.Time,
		&item.Updated,
		&item.Latitude,
		&item.Longitude,
		&depth,
		&magnitude,
		&magType,
		&item.Place,
		&alert,
		&item.Tsunami,
		&item.Sig,
		&item.Type,
		&source,
		&ingested,
	)
	if err != nil {
		return models.Earthquake{}, err
	}

	item.Depth = nullFloatPtr(depth)
	item.Magnitude = nullFloatPtr(magnitude)
	item.MagType = nullStringPtr(magType)
	item.Alert = nullStringPtr(alert)
	if source.Valid {
		item.Source = source.String
	}
	if ingested.Valid {
		item.Ingested = &ingested.Time
	}
	return item, nil
}

func buildWhere(filters models.Filters, includeBBox bool) (string, []any) {
	args := make([]any, 0)
	parts := []string{"1=1"}

	if filters.DateFrom != nil {
		args = append(args, *filters.DateFrom)
		parts = append(parts, "time >= "+placeholder(len(args)))
	}
	if filters.DateTo != nil {
		args = append(args, *filters.DateTo)
		parts = append(parts, "time <= "+placeholder(len(args)))
	}
	if filters.MinMagnitude != nil {
		args = append(args, *filters.MinMagnitude)
		parts = append(parts, "magnitude >= "+placeholder(len(args)))
	}
	if filters.MaxMagnitude != nil {
		args = append(args, *filters.MaxMagnitude)
		parts = append(parts, "magnitude <= "+placeholder(len(args)))
	}
	if filters.MinDepth != nil {
		args = append(args, *filters.MinDepth)
		parts = append(parts, "depth >= "+placeholder(len(args)))
	}
	if filters.MaxDepth != nil {
		args = append(args, *filters.MaxDepth)
		parts = append(parts, "depth <= "+placeholder(len(args)))
	}
	if filters.Tsunami != nil {
		args = append(args, *filters.Tsunami)
		parts = append(parts, "tsunami = "+placeholder(len(args)))
	}
	if filters.Alert != "" {
		args = append(args, filters.Alert)
		parts = append(parts, "alert = "+placeholder(len(args)))
	}
	if filters.Type != "" {
		args = append(args, filters.Type)
		parts = append(parts, "type = "+placeholder(len(args)))
	}
	if includeBBox && filters.BBox != nil {
		bbox := filters.BBox
		args = append(args, bbox.MinLon, bbox.MinLat, bbox.MaxLon, bbox.MaxLat)
		parts = append(
			parts,
			fmt.Sprintf(
				"ST_Intersects(geom, ST_MakeEnvelope(%s, %s, %s, %s, 4326))",
				placeholder(len(args)-3),
				placeholder(len(args)-2),
				placeholder(len(args)-1),
				placeholder(len(args)),
			),
		)
	}

	return "WHERE " + strings.Join(parts, " AND "), args
}

func ClampLimit(limit int) int {
	return clampLimit(limit)
}

func clampLimit(limit int) int {
	if limit <= 0 {
		return 1000
	}
	if limit > maxEarthquakeLimit {
		return maxEarthquakeLimit
	}
	return limit
}

func placeholder(index int) string {
	return "$" + strconv.Itoa(index)
}

func nullFloatPtr(value sql.NullFloat64) *float64 {
	if !value.Valid {
		return nil
	}
	return &value.Float64
}

func floatPtr(value float64) *float64 {
	return &value
}

func nullStringPtr(value sql.NullString) *string {
	if !value.Valid {
		return nil
	}
	return &value.String
}
