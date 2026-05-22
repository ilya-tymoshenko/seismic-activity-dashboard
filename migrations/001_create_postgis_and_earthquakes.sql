-- +goose Up
CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE IF NOT EXISTS earthquakes (
    id VARCHAR(255) PRIMARY KEY,

    time TIMESTAMPTZ NOT NULL,
    updated TIMESTAMPTZ NOT NULL,

    latitude DOUBLE PRECISION NOT NULL,
    longitude DOUBLE PRECISION NOT NULL,
    depth DOUBLE PRECISION,
    magnitude DOUBLE PRECISION,

    mag_type VARCHAR(50),
    place TEXT,
    alert VARCHAR(50),
    tsunami INTEGER,
    sig INTEGER,
    type VARCHAR(80),
    source VARCHAR(50) DEFAULT 'USGS',

    geom geometry(Point, 4326) NOT NULL,
    raw_json JSONB,

    ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_earthquakes_geom
ON earthquakes USING GIST (geom);

CREATE INDEX IF NOT EXISTS idx_earthquakes_time
ON earthquakes (time DESC);

CREATE INDEX IF NOT EXISTS idx_earthquakes_magnitude
ON earthquakes (magnitude DESC);

CREATE INDEX IF NOT EXISTS idx_earthquakes_depth
ON earthquakes (depth);

CREATE INDEX IF NOT EXISTS idx_earthquakes_tsunami
ON earthquakes (tsunami);

CREATE INDEX IF NOT EXISTS idx_earthquakes_type
ON earthquakes (type);

-- +goose Down
DROP TABLE IF EXISTS earthquakes;
DROP EXTENSION IF EXISTS postgis;
