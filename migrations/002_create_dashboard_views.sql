-- +goose Up
CREATE OR REPLACE VIEW vw_dashboard_overview AS
SELECT
    id,
    time,
    updated,
    DATE(time) AS eq_date,
    DATE_TRUNC('month', time)::date AS eq_month,
    EXTRACT(YEAR FROM time)::integer AS eq_year,
    latitude,
    longitude,
    depth,
    magnitude,
    CASE
        WHEN magnitude IS NULL THEN 'Unknown'
        WHEN magnitude < 3 THEN 'Minor'
        WHEN magnitude >= 3 AND magnitude < 5 THEN 'Light'
        WHEN magnitude >= 5 AND magnitude < 7 THEN 'Moderate'
        ELSE 'Severe'
    END AS magnitude_category,
    CASE
        WHEN depth IS NULL THEN 'Unknown'
        WHEN depth < 70 THEN 'Shallow'
        WHEN depth >= 70 AND depth < 300 THEN 'Intermediate'
        ELSE 'Deep'
    END AS depth_category,
    place,
    alert,
    tsunami,
    sig,
    type,
    source
FROM earthquakes;

CREATE OR REPLACE VIEW vw_daily_activity AS
SELECT
    DATE(time) AS eq_date,
    COUNT(*) AS event_count,
    AVG(magnitude) AS avg_magnitude,
    MAX(magnitude) AS max_magnitude,
    AVG(depth) AS avg_depth,
    COUNT(*) FILTER (WHERE tsunami = 1) AS tsunami_count
FROM earthquakes
GROUP BY DATE(time)
ORDER BY eq_date DESC;

CREATE OR REPLACE VIEW vw_magnitude_distribution AS
SELECT
    CASE
        WHEN magnitude IS NULL THEN 'Unknown'
        WHEN magnitude < 3 THEN 'Minor'
        WHEN magnitude >= 3 AND magnitude < 5 THEN 'Light'
        WHEN magnitude >= 5 AND magnitude < 7 THEN 'Moderate'
        ELSE 'Severe'
    END AS magnitude_category,
    COUNT(*) AS event_count,
    AVG(depth) AS avg_depth,
    MAX(magnitude) AS max_magnitude
FROM earthquakes
GROUP BY magnitude_category
ORDER BY event_count DESC;

CREATE OR REPLACE VIEW vw_depth_distribution AS
SELECT
    CASE
        WHEN depth IS NULL THEN 'Unknown'
        WHEN depth < 70 THEN 'Shallow'
        WHEN depth >= 70 AND depth < 300 THEN 'Intermediate'
        ELSE 'Deep'
    END AS depth_category,
    COUNT(*) AS event_count,
    AVG(magnitude) AS avg_magnitude,
    MAX(depth) AS max_depth
FROM earthquakes
GROUP BY depth_category
ORDER BY event_count DESC;

CREATE OR REPLACE VIEW vw_strongest_events AS
SELECT
    id,
    time,
    magnitude,
    depth,
    place,
    latitude,
    longitude,
    tsunami,
    alert
FROM earthquakes
ORDER BY magnitude DESC NULLS LAST, time DESC;

CREATE OR REPLACE VIEW vw_top_places AS
SELECT
    COALESCE(NULLIF(place, ''), 'Unknown') AS place,
    COUNT(*) AS event_count,
    AVG(magnitude) AS avg_magnitude,
    MAX(magnitude) AS max_magnitude,
    AVG(depth) AS avg_depth
FROM earthquakes
GROUP BY COALESCE(NULLIF(place, ''), 'Unknown')
ORDER BY event_count DESC;

-- +goose Down
DROP VIEW IF EXISTS vw_top_places;
DROP VIEW IF EXISTS vw_strongest_events;
DROP VIEW IF EXISTS vw_depth_distribution;
DROP VIEW IF EXISTS vw_magnitude_distribution;
DROP VIEW IF EXISTS vw_daily_activity;
DROP VIEW IF EXISTS vw_dashboard_overview;
