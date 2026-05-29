-- +goose Up
CREATE OR REPLACE VIEW vw_monthly_activity AS
SELECT
    DATE_TRUNC('month', time)::date AS eq_month,
    COUNT(*) AS event_count,
    AVG(magnitude) AS avg_magnitude,
    MAX(magnitude) AS max_magnitude,
    AVG(depth) AS avg_depth,
    COUNT(*) FILTER (WHERE tsunami = 1) AS tsunami_count,
    COUNT(*) FILTER (WHERE magnitude >= 5) AS significant_count,
    COUNT(*) FILTER (WHERE alert IN ('orange', 'red')) AS high_alert_count
FROM earthquakes
GROUP BY DATE_TRUNC('month', time)::date
ORDER BY eq_month DESC;

CREATE OR REPLACE VIEW vw_yearly_activity AS
SELECT
    DATE_TRUNC('year', time)::date AS eq_year,
    COUNT(*) AS event_count,
    AVG(magnitude) AS avg_magnitude,
    MAX(magnitude) AS max_magnitude,
    AVG(depth) AS avg_depth,
    COUNT(*) FILTER (WHERE tsunami = 1) AS tsunami_count,
    COUNT(*) FILTER (WHERE magnitude >= 5) AS significant_count
FROM earthquakes
GROUP BY DATE_TRUNC('year', time)::date
ORDER BY eq_year DESC;

CREATE OR REPLACE VIEW vw_alert_distribution AS
SELECT
    COALESCE(NULLIF(alert, ''), 'none') AS alert_level,
    CASE COALESCE(NULLIF(alert, ''), 'none')
        WHEN 'red' THEN 5
        WHEN 'orange' THEN 4
        WHEN 'yellow' THEN 3
        WHEN 'green' THEN 2
        ELSE 1
    END AS severity_rank,
    COUNT(*) AS event_count,
    AVG(magnitude) AS avg_magnitude,
    MAX(magnitude) AS max_magnitude,
    COUNT(*) FILTER (WHERE tsunami = 1) AS tsunami_count
FROM earthquakes
GROUP BY COALESCE(NULLIF(alert, ''), 'none')
ORDER BY severity_rank DESC;

CREATE OR REPLACE VIEW vw_event_type_distribution AS
SELECT
    COALESCE(NULLIF(type, ''), 'unknown') AS event_type,
    COUNT(*) AS event_count,
    AVG(magnitude) AS avg_magnitude,
    MAX(magnitude) AS max_magnitude,
    AVG(depth) AS avg_depth
FROM earthquakes
GROUP BY COALESCE(NULLIF(type, ''), 'unknown')
ORDER BY event_count DESC;

CREATE OR REPLACE VIEW vw_tsunami_activity AS
SELECT
    DATE_TRUNC('month', time)::date AS eq_month,
    COUNT(*) AS tsunami_count,
    AVG(magnitude) AS avg_magnitude,
    MAX(magnitude) AS max_magnitude,
    AVG(depth) AS avg_depth
FROM earthquakes
WHERE tsunami = 1
GROUP BY DATE_TRUNC('month', time)::date
ORDER BY eq_month DESC;

CREATE OR REPLACE VIEW vw_high_risk_events AS
SELECT
    id,
    time,
    magnitude,
    depth,
    place,
    latitude,
    longitude,
    tsunami,
    alert,
    CONCAT_WS(
        ', ',
        CASE WHEN magnitude >= 6 THEN 'magnitude >= 6' END,
        CASE WHEN tsunami = 1 THEN 'tsunami' END,
        CASE WHEN alert IN ('orange', 'red') THEN 'high alert' END
    ) AS risk_reason
FROM earthquakes
WHERE magnitude >= 6
   OR tsunami = 1
   OR alert IN ('orange', 'red')
ORDER BY time DESC;

CREATE OR REPLACE VIEW vw_depth_magnitude_matrix AS
SELECT
    CASE
        WHEN depth IS NULL THEN 'Unknown'
        WHEN depth < 70 THEN 'Shallow'
        WHEN depth >= 70 AND depth < 300 THEN 'Intermediate'
        ELSE 'Deep'
    END AS depth_category,
    CASE
        WHEN magnitude IS NULL THEN 'Unknown'
        WHEN magnitude < 3 THEN 'Minor'
        WHEN magnitude >= 3 AND magnitude < 5 THEN 'Light'
        WHEN magnitude >= 5 AND magnitude < 7 THEN 'Moderate'
        ELSE 'Severe'
    END AS magnitude_category,
    COUNT(*) AS event_count,
    AVG(magnitude) AS avg_magnitude,
    AVG(depth) AS avg_depth
FROM earthquakes
GROUP BY depth_category, magnitude_category
ORDER BY depth_category, magnitude_category;

CREATE OR REPLACE VIEW vw_regional_hotspots AS
WITH bucketed AS (
    SELECT
        FLOOR(latitude / 10) * 10 AS lat_min,
        FLOOR(longitude / 10) * 10 AS lon_min,
        magnitude,
        depth,
        tsunami
    FROM earthquakes
)
SELECT
    lat_min,
    lon_min,
    lat_min + 5 AS latitude,
    lon_min + 5 AS longitude,
    COUNT(*) AS event_count,
    AVG(magnitude) AS avg_magnitude,
    MAX(magnitude) AS max_magnitude,
    AVG(depth) AS avg_depth,
    COUNT(*) FILTER (WHERE tsunami = 1) AS tsunami_count
FROM bucketed
GROUP BY lat_min, lon_min
HAVING COUNT(*) >= 5
ORDER BY event_count DESC;

-- +goose Down
DROP VIEW IF EXISTS vw_regional_hotspots;
DROP VIEW IF EXISTS vw_depth_magnitude_matrix;
DROP VIEW IF EXISTS vw_high_risk_events;
DROP VIEW IF EXISTS vw_tsunami_activity;
DROP VIEW IF EXISTS vw_event_type_distribution;
DROP VIEW IF EXISTS vw_alert_distribution;
DROP VIEW IF EXISTS vw_yearly_activity;
DROP VIEW IF EXISTS vw_monthly_activity;
