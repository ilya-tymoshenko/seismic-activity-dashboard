# System analityki swiatowej aktywnosci sejsmicznej

## Stack
Go/Gin, PostgreSQL 16 + PostGIS, Goose migrations, Next.js Pages Router, Tailwind CSS, Leaflet, Recharts, Metabase, Docker Compose.

## How to run
```bash
docker compose up --build
```

Backend check:
```bash
curl http://localhost:8080/api/health
```

## How to import data
Fresh USGS feed:
```bash
curl -X POST "http://localhost:8080/api/sync?feed=2.5_day"
```

Historical import:
```bash
curl -X POST "http://localhost:8080/api/import/history?days=365&minMagnitude=2.5&chunkDays=30"
```

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
