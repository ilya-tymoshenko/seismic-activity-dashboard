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
It creates the admin user, the PostgreSQL connection, and the `Earthquake BI Overview` dashboard.

- Email: admin@example.com
- Password: admin12345

## Metabase connection
- Host: postgres
- Port: 5432
- DB: earthquakes
- User: postgres
- Password: postgres
