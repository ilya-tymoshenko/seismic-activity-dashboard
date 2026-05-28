package repository

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"math"
	"sort"
	"strconv"
	"strings"
	"time"

	"earthquake-big-data/backend/internal/models"
)

const (
	maxEarthquakeLimit     = 5000
	maxHybridClusterEvents = 20000
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

func (r *EarthquakeRepository) Clusters(ctx context.Context, filters models.Filters, options models.ClusterOptions) ([]models.Cluster, error) {
	options = normalizeClusterOptions(options)
	if filters.BBox == nil {
		return r.gridClusters(ctx, filters, options)
	}

	overCap, err := r.clusterEventCountExceeds(ctx, filters, maxHybridClusterEvents)
	if err != nil {
		return nil, err
	}
	if overCap {
		return r.gridClusters(ctx, filters, options)
	}
	if options.Mode == "spatial" {
		return r.spatialClusters(ctx, filters, options.Eps, options.MinPoints)
	}
	return r.hybridClusters(ctx, filters, options)
}

func (r *EarthquakeRepository) spatialClusters(ctx context.Context, filters models.Filters, eps float64, minPoints int) ([]models.Cluster, error) {
	where, args := buildWhere(filters, true)
	args = append(args, eps)
	epsPlaceholder := placeholder(len(args))
	args = append(args, minPoints)
	minPointsPlaceholder := placeholder(len(args))

	query := fmt.Sprintf(`
WITH filtered AS (
  SELECT
    id,
    magnitude,
    depth,
    geom
  FROM earthquakes
  %s
),
clustered_events AS (
  SELECT
    id,
    magnitude,
    depth,
    geom,
    ST_ClusterDBSCAN(geom, eps := %s, minpoints := %s) OVER () AS cluster_id
  FROM filtered
),
valid_clusters AS (
  SELECT
    cluster_id,
    COUNT(*) AS event_count,
    AVG(magnitude) AS avg_magnitude,
    MAX(magnitude) AS max_magnitude,
    AVG(depth) AS avg_depth,
    ST_Centroid(ST_Collect(geom)) AS center_geom
  FROM clustered_events
  WHERE cluster_id IS NOT NULL
  GROUP BY cluster_id
)
SELECT
  cluster_id,
  event_count,
  avg_magnitude,
  max_magnitude,
  avg_depth,
  ST_Y(center_geom) AS latitude,
  ST_X(center_geom) AS longitude
FROM valid_clusters
ORDER BY event_count DESC
LIMIT 100`, where, epsPlaceholder, minPointsPlaceholder)

	rows, err := r.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	clusters := make([]models.Cluster, 0)
	for rows.Next() {
		var cluster models.Cluster
		var avgMag, maxMag, avgDepth sql.NullFloat64
		if err := rows.Scan(&cluster.ClusterID, &cluster.EventCount, &avgMag, &maxMag, &avgDepth, &cluster.Latitude, &cluster.Longitude); err != nil {
			return nil, err
		}
		cluster.AvgMagnitude = nullFloatPtr(avgMag)
		cluster.MaxMagnitude = nullFloatPtr(maxMag)
		cluster.AvgDepth = nullFloatPtr(avgDepth)
		clusters = append(clusters, cluster)
	}
	return clusters, rows.Err()
}

func (r *EarthquakeRepository) gridClusters(ctx context.Context, filters models.Filters, options models.ClusterOptions) ([]models.Cluster, error) {
	where, args := buildWhere(filters, true)
	args = append(args, spatialFallbackEps(options))
	bucketPlaceholder := placeholder(len(args))
	args = append(args, options.MinPoints)
	minPointsPlaceholder := placeholder(len(args))

	query := fmt.Sprintf(`
WITH filtered AS (
  SELECT
    latitude,
    longitude,
    magnitude,
    depth,
    FLOOR((latitude + 90) / %[1]s) AS lat_bucket,
    FLOOR((longitude + 180) / %[1]s) AS lon_bucket
  FROM earthquakes
  %[2]s
),
grid AS (
  SELECT
    lat_bucket,
    lon_bucket,
    COUNT(*) AS event_count,
    AVG(magnitude) AS avg_magnitude,
    MAX(magnitude) AS max_magnitude,
    AVG(depth) AS avg_depth,
    AVG(latitude) AS latitude,
    CASE
      WHEN ABS(SUM(SIN(RADIANS(longitude)))) < 1e-12
       AND ABS(SUM(COS(RADIANS(longitude)))) < 1e-12
      THEN AVG(longitude)
      ELSE DEGREES(ATAN2(SUM(SIN(RADIANS(longitude))), SUM(COS(RADIANS(longitude)))))
    END AS longitude
  FROM filtered
  GROUP BY lat_bucket, lon_bucket
  HAVING COUNT(*) >= %[3]s
),
ranked AS (
  SELECT
    ROW_NUMBER() OVER (ORDER BY event_count DESC, lat_bucket, lon_bucket) - 1 AS cluster_id,
    event_count,
    avg_magnitude,
    max_magnitude,
    avg_depth,
    latitude,
    CASE
      WHEN longitude > 180 THEN longitude - 360
      WHEN longitude < -180 THEN longitude + 360
      ELSE longitude
    END AS longitude
  FROM grid
)
SELECT
  cluster_id,
  event_count,
  avg_magnitude,
  max_magnitude,
  avg_depth,
  latitude,
  longitude
FROM ranked
ORDER BY event_count DESC
LIMIT 100`, bucketPlaceholder, where, minPointsPlaceholder)

	rows, err := r.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	clusters := make([]models.Cluster, 0)
	for rows.Next() {
		var cluster models.Cluster
		var avgMag, maxMag, avgDepth sql.NullFloat64
		if err := rows.Scan(&cluster.ClusterID, &cluster.EventCount, &avgMag, &maxMag, &avgDepth, &cluster.Latitude, &cluster.Longitude); err != nil {
			return nil, err
		}
		cluster.AvgMagnitude = nullFloatPtr(avgMag)
		cluster.MaxMagnitude = nullFloatPtr(maxMag)
		cluster.AvgDepth = nullFloatPtr(avgDepth)
		clusters = append(clusters, cluster)
	}
	return clusters, rows.Err()
}

type clusterEvent struct {
	id        string
	latitude  float64
	longitude float64
	magnitude sql.NullFloat64
	depth     sql.NullFloat64
}

type clusterGridKey struct {
	x int
	y int
}

type clusterAggregate struct {
	count      int64
	latitude   float64
	lonSinSum  float64
	lonCosSum  float64
	magSum     float64
	magCount   int64
	maxMag     sql.NullFloat64
	depthSum   float64
	depthCount int64
}

func (r *EarthquakeRepository) hybridClusters(ctx context.Context, filters models.Filters, options models.ClusterOptions) ([]models.Cluster, error) {
	events, err := r.clusterEvents(ctx, filters)
	if err != nil {
		return nil, err
	}
	if len(events) == 0 {
		return []models.Cluster{}, nil
	}

	radiusKm := options.SpatialEpsKm * options.Eps
	cellDegrees := math.Max(radiusKm/111.0, 0.5)
	grid := buildClusterGrid(events, cellDegrees)
	labels := make([]int, len(events))
	for index := range labels {
		labels[index] = -2
	}

	clusterID := 0
	for index := range events {
		if labels[index] != -2 {
			continue
		}

		neighbors := regionQuery(events, grid, index, options, cellDegrees)
		if len(neighbors) < options.MinPoints {
			labels[index] = -1
			continue
		}

		expandCluster(events, grid, labels, index, neighbors, clusterID, options, cellDegrees)
		clusterID++
	}

	return aggregateClusters(events, labels), nil
}

func (r *EarthquakeRepository) clusterEvents(ctx context.Context, filters models.Filters) ([]clusterEvent, error) {
	where, args := buildWhere(filters, true)
	args = append(args, maxHybridClusterEvents+1)
	limitPlaceholder := placeholder(len(args))
	query := `
SELECT id, latitude, longitude, magnitude, depth
FROM earthquakes
` + where + `
ORDER BY time DESC
LIMIT ` + limitPlaceholder

	rows, err := r.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	events := make([]clusterEvent, 0)
	for rows.Next() {
		var event clusterEvent
		if err := rows.Scan(&event.id, &event.latitude, &event.longitude, &event.magnitude, &event.depth); err != nil {
			return nil, err
		}
		events = append(events, event)
	}
	return events, rows.Err()
}

func (r *EarthquakeRepository) clusterEventCountExceeds(ctx context.Context, filters models.Filters, limit int) (bool, error) {
	where, args := buildWhere(filters, true)
	args = append(args, limit+1)
	limitPlaceholder := placeholder(len(args))
	query := `
SELECT COUNT(*)
FROM (
  SELECT 1
  FROM earthquakes
  ` + where + `
  LIMIT ` + limitPlaceholder + `
) capped_events`

	var count int64
	if err := r.db.QueryRowContext(ctx, query, args...).Scan(&count); err != nil {
		return false, err
	}
	return count > int64(limit), nil
}

func spatialFallbackEps(options models.ClusterOptions) float64 {
	radiusKm := options.SpatialEpsKm * options.Eps
	if radiusKm <= 0 {
		return 2.0
	}
	return math.Max(radiusKm/111.0, 0.1)
}

func buildClusterGrid(events []clusterEvent, cellDegrees float64) map[clusterGridKey][]int {
	grid := make(map[clusterGridKey][]int, len(events))
	xCells := longitudeCellCount(cellDegrees)
	for index, event := range events {
		key := clusterGridKey{
			x: longitudeCellIndex(event.longitude, cellDegrees, xCells),
			y: int(math.Floor((event.latitude + 90) / cellDegrees)),
		}
		grid[key] = append(grid[key], index)
	}
	return grid
}

func expandCluster(events []clusterEvent, grid map[clusterGridKey][]int, labels []int, index int, neighbors []int, clusterID int, options models.ClusterOptions, cellDegrees float64) {
	labels[index] = clusterID
	queued := make([]bool, len(events))
	queue := make([]int, 0, len(neighbors))
	for _, neighbor := range neighbors {
		if neighbor == index || queued[neighbor] {
			continue
		}
		queued[neighbor] = true
		queue = append(queue, neighbor)
	}

	for cursor := 0; cursor < len(queue); cursor++ {
		neighbor := queue[cursor]
		if labels[neighbor] == -1 {
			labels[neighbor] = clusterID
		}
		if labels[neighbor] != -2 {
			continue
		}

		labels[neighbor] = clusterID
		neighborRegion := regionQuery(events, grid, neighbor, options, cellDegrees)
		if len(neighborRegion) < options.MinPoints {
			continue
		}
		for _, candidate := range neighborRegion {
			if queued[candidate] {
				continue
			}
			queued[candidate] = true
			queue = append(queue, candidate)
		}
	}
}

func regionQuery(events []clusterEvent, grid map[clusterGridKey][]int, index int, options models.ClusterOptions, cellDegrees float64) []int {
	event := events[index]
	xCells := longitudeCellCount(cellDegrees)
	key := clusterGridKey{
		x: longitudeCellIndex(event.longitude, cellDegrees, xCells),
		y: int(math.Floor((event.latitude + 90) / cellDegrees)),
	}
	span := int(math.Ceil(options.Eps)) + 1
	xSpan := longitudeCellSpan(event.latitude, span, xCells)
	xCellIndexes := longitudeCells(key.x, xSpan, xCells)
	neighbors := make([]int, 0, options.MinPoints)
	for dy := -span; dy <= span; dy++ {
		for _, x := range xCellIndexes {
			candidates := grid[clusterGridKey{x: x, y: key.y + dy}]
			for _, candidate := range candidates {
				if clusterDistance(event, events[candidate], options) <= options.Eps {
					neighbors = append(neighbors, candidate)
				}
			}
		}
	}
	return neighbors
}

func longitudeCellCount(cellDegrees float64) int {
	if cellDegrees <= 0 {
		return 0
	}
	return int(math.Ceil(360 / cellDegrees))
}

func longitudeCellIndex(longitude float64, cellDegrees float64, xCells int) int {
	if cellDegrees <= 0 {
		return 0
	}
	x := int(math.Floor((longitude + 180) / cellDegrees))
	if xCells > 0 {
		x = ((x % xCells) + xCells) % xCells
	}
	return x
}

func longitudeCells(center int, span int, xCells int) []int {
	if xCells <= 0 {
		return []int{center}
	}
	if span*2+1 >= xCells {
		cells := make([]int, xCells)
		for x := 0; x < xCells; x++ {
			cells[x] = x
		}
		return cells
	}

	cells := make([]int, 0, span*2+1)
	for dx := -span; dx <= span; dx++ {
		x := center + dx
		x = ((x % xCells) + xCells) % xCells
		cells = append(cells, x)
	}
	return cells
}

func longitudeCellSpan(latitude float64, baseSpan int, xCells int) int {
	if baseSpan < 1 {
		baseSpan = 1
	}
	if xCells <= 0 {
		return baseSpan
	}

	cosLatitude := math.Cos(math.Abs(latitude) * math.Pi / 180)
	if cosLatitude <= 0.01 {
		return xCells
	}
	span := int(math.Ceil(float64(baseSpan) / cosLatitude))
	if span > xCells {
		return xCells
	}
	if span < baseSpan {
		return baseSpan
	}
	return span
}

func circularMeanLongitude(sinSum float64, cosSum float64, fallback float64) float64 {
	if math.Hypot(sinSum, cosSum) < 1e-12 {
		return normalizeLongitude(fallback)
	}
	return normalizeLongitude(math.Atan2(sinSum, cosSum) * 180 / math.Pi)
}

func normalizeLongitude(longitude float64) float64 {
	for longitude > 180 {
		longitude -= 360
	}
	for longitude < -180 {
		longitude += 360
	}
	return longitude
}

func addLongitude(aggregate *clusterAggregate, longitude float64) {
	radians := longitude * math.Pi / 180
	aggregate.lonSinSum += math.Sin(radians)
	aggregate.lonCosSum += math.Cos(radians)
}

func fallbackAverageLongitude(events []clusterEvent, labels []int, label int) float64 {
	var sum float64
	var count int64
	for index, event := range events {
		if labels[index] == label {
			sum += event.longitude
			count++
		}
	}
	if count == 0 {
		return 0
	}
	return sum / float64(count)
}

func clusterDistance(a clusterEvent, b clusterEvent, options models.ClusterOptions) float64 {
	spatial := haversineKm(a.latitude, a.longitude, b.latitude, b.longitude) / options.SpatialEpsKm
	sum := spatial * spatial
	if a.depth.Valid && b.depth.Valid {
		depth := (a.depth.Float64 - b.depth.Float64) / options.DepthScaleKm
		sum += depth * depth
	}
	if a.magnitude.Valid && b.magnitude.Valid {
		magnitude := (a.magnitude.Float64 - b.magnitude.Float64) / options.MagnitudeScale
		sum += magnitude * magnitude
	}
	return math.Sqrt(sum)
}

func aggregateClusters(events []clusterEvent, labels []int) []models.Cluster {
	aggregates := make(map[int]*clusterAggregate)
	for index, label := range labels {
		if label < 0 {
			continue
		}
		event := events[index]
		aggregate := aggregates[label]
		if aggregate == nil {
			aggregate = &clusterAggregate{}
			aggregates[label] = aggregate
		}

		aggregate.count++
		aggregate.latitude += event.latitude
		addLongitude(aggregate, event.longitude)
		if event.magnitude.Valid {
			aggregate.magSum += event.magnitude.Float64
			aggregate.magCount++
			if !aggregate.maxMag.Valid || event.magnitude.Float64 > aggregate.maxMag.Float64 {
				aggregate.maxMag = event.magnitude
			}
		}
		if event.depth.Valid {
			aggregate.depthSum += event.depth.Float64
			aggregate.depthCount++
		}
	}

	clusters := make([]models.Cluster, 0, len(aggregates))
	for id, aggregate := range aggregates {
		cluster := models.Cluster{
			ClusterID:  int64(id),
			EventCount: aggregate.count,
			Latitude:   aggregate.latitude / float64(aggregate.count),
			Longitude:  circularMeanLongitude(aggregate.lonSinSum, aggregate.lonCosSum, fallbackAverageLongitude(events, labels, id)),
		}
		if aggregate.magCount > 0 {
			cluster.AvgMagnitude = floatPtr(aggregate.magSum / float64(aggregate.magCount))
			cluster.MaxMagnitude = floatPtr(aggregate.maxMag.Float64)
		}
		if aggregate.depthCount > 0 {
			cluster.AvgDepth = floatPtr(aggregate.depthSum / float64(aggregate.depthCount))
		}
		clusters = append(clusters, cluster)
	}

	sort.Slice(clusters, func(i int, j int) bool {
		if clusters[i].EventCount == clusters[j].EventCount {
			return clusters[i].ClusterID < clusters[j].ClusterID
		}
		return clusters[i].EventCount > clusters[j].EventCount
	})
	if len(clusters) > 100 {
		clusters = clusters[:100]
	}
	return clusters
}

func haversineKm(lat1 float64, lon1 float64, lat2 float64, lon2 float64) float64 {
	const earthRadiusKm = 6371.0088
	lat1Rad := lat1 * math.Pi / 180
	lat2Rad := lat2 * math.Pi / 180
	deltaLat := (lat2 - lat1) * math.Pi / 180
	deltaLon := (lon2 - lon1) * math.Pi / 180

	a := math.Sin(deltaLat/2)*math.Sin(deltaLat/2) +
		math.Cos(lat1Rad)*math.Cos(lat2Rad)*math.Sin(deltaLon/2)*math.Sin(deltaLon/2)
	return earthRadiusKm * 2 * math.Atan2(math.Sqrt(a), math.Sqrt(1-a))
}

func normalizeClusterOptions(options models.ClusterOptions) models.ClusterOptions {
	options.Mode = strings.ToLower(strings.TrimSpace(options.Mode))
	if options.Mode != "spatial" {
		options.Mode = "hybrid"
	}
	if options.MinPoints <= 0 {
		options.MinPoints = 10
	} else if options.MinPoints > models.MaxClusterMinPoints {
		options.MinPoints = models.MaxClusterMinPoints
	}
	if !isFinitePositive(options.Eps) {
		if options.Mode == "spatial" {
			options.Eps = 2.0
		} else {
			options.Eps = 1.0
		}
	} else if options.Eps > models.MaxClusterEps {
		options.Eps = models.MaxClusterEps
	}
	if !isFinitePositive(options.SpatialEpsKm) {
		options.SpatialEpsKm = 300
	} else if options.SpatialEpsKm > models.MaxClusterSpatialEpsKm {
		options.SpatialEpsKm = models.MaxClusterSpatialEpsKm
	}
	if !isFinitePositive(options.DepthScaleKm) {
		options.DepthScaleKm = 100
	} else if options.DepthScaleKm > models.MaxClusterDepthScaleKm {
		options.DepthScaleKm = models.MaxClusterDepthScaleKm
	}
	if !isFinitePositive(options.MagnitudeScale) {
		options.MagnitudeScale = 1
	} else if options.MagnitudeScale > models.MaxClusterMagnitudeScale {
		options.MagnitudeScale = models.MaxClusterMagnitudeScale
	}
	return options
}

func isFinitePositive(value float64) bool {
	return value > 0 && !math.IsNaN(value) && !math.IsInf(value, 0)
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
