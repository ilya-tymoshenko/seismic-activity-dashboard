# System analityki swiatowej aktywnosci sejsmicznej

## Stack
Go/Gin, PostgreSQL 16 + PostGIS, Goose migrations, Next.js Pages Router, Tailwind CSS, Leaflet, Recharts, Metabase, Docker Compose.

## How to run
```bash
docker compose up --build
```

Frontend watch mode:
```bash
docker compose -f docker-compose.yml -f docker-compose.watch.yml watch frontend
```

Backend check:
```bash
curl http://localhost:8080/api/health
```

## How to import data
Local startup seed:
```bash
python3 scripts/build_usgs_seed.py --end 2026-05-28 --min-magnitude 2.5 --chunk-days 365
```

The generated `data/usgs_seed.geojson` file is local-only and ignored by git. Copy or generate it on the server before first `docker compose up` if the server should start with a prefilled database.

Fresh USGS feed:
```bash
curl -X POST "http://localhost:8080/api/sync?feed=2.5_day"
```

Historical import:
```bash
curl -X POST "http://localhost:8080/api/import/history?days=3650&minMagnitude=2.5&chunkDays=30"
```

On first startup the backend imports the local seed file from `USGS_SEED_FILE` (`/data/usgs_seed.geojson` by default), then keeps the database fresh with `USGS_SYNC_FEED` every `USGS_SYNC_INTERVAL`.

## URLs
- Frontend: http://localhost:3000
- Backend: http://localhost:8080
- Metabase: http://localhost:3001
- PostgreSQL: localhost:5432

## Metabase login
Metabase is bootstrapped automatically on an empty volume.
It creates the admin user, the PostgreSQL connection, and several ready-to-use BI dashboards:

- `Earthquake BI Overview`: KPI counters, daily activity, magnitude/depth distribution, strongest events, active places.
- `Earthquake Temporal Trends`: yearly/monthly trends, significant events, event type distribution.
- `Earthquake Risk Monitor`: alert levels, tsunami activity, high-risk events, depth/magnitude matrix.
- `Earthquake Geographic Hotspots`: hotspot maps, high-risk event map, regional grid, active places, strongest location table.
- `Earthquake Data Coverage & Quality`: coverage, missing fields, ingestion recency, magnitude thresholds, import state.

The analytical dashboards include global filters for date, magnitude, depth, alert level, event type, and tsunami flag. BI materialized views are refreshed after seed import, manual imports, and scheduled syncs.
Metabase stores its own application state in the dedicated `metabase-db` PostgreSQL service.

- Email: admin@example.com
- Password: admin12345

### Migrating an existing local Metabase H2 volume
Older local versions stored Metabase state in the `metabase-data` H2 volume. To preserve existing Metabase users, credentials, and custom dashboards before switching to the PostgreSQL-backed Metabase app DB, back up that volume first, then run:

```bash
docker compose stop metabase
docker compose --profile tools run --rm metabase-migrate-h2
docker compose up -d metabase metabase-setup
```

Run the migration before bootstrapping a fresh `metabase-pgdata` volume. If a fresh PostgreSQL Metabase DB was already initialized accidentally, remove that new volume first or keep using the new clean Metabase state.
The migration container mounts `metabase-data` read-write because Metabase's H2 loader creates lock/trace files next to `metabase.db`.

## Metabase connection
- Host: postgres
- Port: 5432
- DB: earthquakes
- User: postgres
- Password: postgres
