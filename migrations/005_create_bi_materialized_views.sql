-- +goose Up
CREATE INDEX IF NOT EXISTS idx_earthquakes_bi_time_magnitude_depth
ON earthquakes (time DESC, magnitude, depth);

CREATE INDEX IF NOT EXISTS idx_earthquakes_bi_alert_type_tsunami
ON earthquakes (alert, type, tsunami);

CREATE INDEX IF NOT EXISTS idx_earthquakes_ingested_at
ON earthquakes (ingested_at DESC);

CREATE OR REPLACE VIEW vw_data_quality_summary AS
SELECT
    COUNT(*) AS total_events,
    MIN(time) AS oldest_event_time,
    MAX(time) AS newest_event_time,
    MIN(ingested_at) AS first_ingested_at,
    MAX(ingested_at) AS last_ingested_at,
    COUNT(*) FILTER (WHERE magnitude IS NULL) AS missing_magnitude,
    COUNT(*) FILTER (WHERE depth IS NULL) AS missing_depth,
    COUNT(*) FILTER (WHERE place IS NULL OR place = '') AS missing_place,
    COUNT(*) FILTER (WHERE alert IS NULL OR alert = '') AS missing_alert,
    COUNT(*) FILTER (WHERE type IS NULL OR type = '') AS missing_type,
    COUNT(*) FILTER (WHERE latitude < -90 OR latitude > 90 OR longitude < -180 OR longitude > 180) AS invalid_coordinates,
    COUNT(*) FILTER (WHERE magnitude >= 2.5) AS events_magnitude_2_5_plus,
    COUNT(*) FILTER (WHERE magnitude >= 5) AS events_magnitude_5_plus,
    COUNT(*) FILTER (WHERE tsunami = 1) AS tsunami_events,
    COUNT(DISTINCT DATE_TRUNC('year', time)) AS covered_years
FROM earthquakes;

CREATE OR REPLACE VIEW vw_data_quality_fields AS
WITH counts AS (
    SELECT
        COUNT(*)::numeric AS total_events,
        COUNT(*) FILTER (WHERE magnitude IS NULL) AS missing_magnitude,
        COUNT(*) FILTER (WHERE depth IS NULL) AS missing_depth,
        COUNT(*) FILTER (WHERE place IS NULL OR place = '') AS missing_place,
        COUNT(*) FILTER (WHERE alert IS NULL OR alert = '') AS missing_alert,
        COUNT(*) FILTER (WHERE type IS NULL OR type = '') AS missing_type
    FROM earthquakes
)
SELECT 'magnitude' AS field_name, missing_magnitude AS missing_count, ROUND((missing_magnitude::numeric / NULLIF(total_events, 0)) * 100, 2) AS missing_percent
FROM counts
UNION ALL
SELECT 'depth', missing_depth, ROUND((missing_depth::numeric / NULLIF(total_events, 0)) * 100, 2)
FROM counts
UNION ALL
SELECT 'place', missing_place, ROUND((missing_place::numeric / NULLIF(total_events, 0)) * 100, 2)
FROM counts
UNION ALL
SELECT 'alert', missing_alert, ROUND((missing_alert::numeric / NULLIF(total_events, 0)) * 100, 2)
FROM counts
UNION ALL
SELECT 'type', missing_type, ROUND((missing_type::numeric / NULLIF(total_events, 0)) * 100, 2)
FROM counts
ORDER BY missing_count DESC;

CREATE OR REPLACE VIEW vw_data_quality_by_year AS
SELECT
    DATE_TRUNC('year', time)::date AS eq_year,
    COUNT(*) AS event_count,
    COUNT(*) FILTER (WHERE magnitude IS NULL) AS missing_magnitude,
    COUNT(*) FILTER (WHERE depth IS NULL) AS missing_depth,
    COUNT(*) FILTER (WHERE place IS NULL OR place = '') AS missing_place,
    COUNT(*) FILTER (WHERE alert IS NULL OR alert = '') AS missing_alert,
    COUNT(*) FILTER (WHERE magnitude >= 2.5) AS magnitude_2_5_plus,
    COUNT(*) FILTER (WHERE magnitude >= 5) AS magnitude_5_plus,
    MIN(time) AS oldest_event_time,
    MAX(time) AS newest_event_time
FROM earthquakes
GROUP BY DATE_TRUNC('year', time)::date
ORDER BY eq_year DESC;

CREATE OR REPLACE VIEW vw_recent_ingestion AS
SELECT
    DATE(ingested_at) AS ingest_date,
    COUNT(*) AS event_count,
    MIN(time) AS oldest_event_time,
    MAX(time) AS newest_event_time
FROM earthquakes
GROUP BY DATE(ingested_at)
ORDER BY ingest_date DESC;

CREATE OR REPLACE VIEW vw_import_state_status AS
WITH parsed AS (
    SELECT
        key,
        value,
        updated_at,
        CASE
            WHEN LEFT(TRIM(value), 1) = '{' THEN value::jsonb
            ELSE NULL
        END AS payload
    FROM import_state
)
SELECT
    key,
    updated_at,
    payload ->> 'id' AS job_id,
    payload ->> 'kind' AS job_kind,
    payload ->> 'status' AS job_status,
    payload ->> 'message' AS job_message,
    NULLIF(payload ->> 'progress', '')::numeric AS progress,
    CASE
        WHEN payload IS NULL THEN value
        ELSE NULL
    END AS raw_value
FROM parsed
ORDER BY updated_at DESC;

CREATE OR REPLACE VIEW vw_magnitude_threshold_coverage AS
SELECT *
FROM (
    VALUES
        ('all', NULL::double precision),
        ('1.0+', 1.0),
        ('2.5+', 2.5),
        ('4.5+', 4.5),
        ('5.0+', 5.0),
        ('6.0+', 6.0),
        ('7.0+', 7.0)
) AS threshold(label, min_magnitude)
CROSS JOIN LATERAL (
    SELECT COUNT(*) AS event_count
    FROM earthquakes
    WHERE threshold.min_magnitude IS NULL OR magnitude >= threshold.min_magnitude
) AS counts
ORDER BY threshold.min_magnitude NULLS FIRST;

CREATE MATERIALIZED VIEW mv_bi_daily_activity AS
SELECT * FROM vw_daily_activity;

CREATE UNIQUE INDEX idx_mv_bi_daily_activity_date
ON mv_bi_daily_activity (eq_date);

CREATE MATERIALIZED VIEW mv_bi_monthly_activity AS
SELECT * FROM vw_monthly_activity;

CREATE UNIQUE INDEX idx_mv_bi_monthly_activity_month
ON mv_bi_monthly_activity (eq_month);

CREATE MATERIALIZED VIEW mv_bi_yearly_activity AS
SELECT * FROM vw_yearly_activity;

CREATE UNIQUE INDEX idx_mv_bi_yearly_activity_year
ON mv_bi_yearly_activity (eq_year);

CREATE MATERIALIZED VIEW mv_bi_regional_hotspots AS
SELECT * FROM vw_regional_hotspots;

CREATE UNIQUE INDEX idx_mv_bi_regional_hotspots_bucket
ON mv_bi_regional_hotspots (lat_min, lon_min);

CREATE MATERIALIZED VIEW mv_bi_data_quality_by_year AS
SELECT * FROM vw_data_quality_by_year;

CREATE UNIQUE INDEX idx_mv_bi_data_quality_by_year
ON mv_bi_data_quality_by_year (eq_year);

-- +goose StatementBegin
CREATE OR REPLACE FUNCTION refresh_bi_materialized_views()
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
    REFRESH MATERIALIZED VIEW mv_bi_daily_activity;
    REFRESH MATERIALIZED VIEW mv_bi_monthly_activity;
    REFRESH MATERIALIZED VIEW mv_bi_yearly_activity;
    REFRESH MATERIALIZED VIEW mv_bi_regional_hotspots;
    REFRESH MATERIALIZED VIEW mv_bi_data_quality_by_year;
END;
$$;
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP FUNCTION IF EXISTS refresh_bi_materialized_views();
-- +goose StatementEnd
DROP MATERIALIZED VIEW IF EXISTS mv_bi_data_quality_by_year;
DROP MATERIALIZED VIEW IF EXISTS mv_bi_regional_hotspots;
DROP MATERIALIZED VIEW IF EXISTS mv_bi_yearly_activity;
DROP MATERIALIZED VIEW IF EXISTS mv_bi_monthly_activity;
DROP MATERIALIZED VIEW IF EXISTS mv_bi_daily_activity;
DROP VIEW IF EXISTS vw_magnitude_threshold_coverage;
DROP VIEW IF EXISTS vw_import_state_status;
DROP VIEW IF EXISTS vw_recent_ingestion;
DROP VIEW IF EXISTS vw_data_quality_by_year;
DROP VIEW IF EXISTS vw_data_quality_fields;
DROP VIEW IF EXISTS vw_data_quality_summary;
DROP INDEX IF EXISTS idx_earthquakes_ingested_at;
DROP INDEX IF EXISTS idx_earthquakes_bi_alert_type_tsunami;
DROP INDEX IF EXISTS idx_earthquakes_bi_time_magnitude_depth;
