# Local USGS seed data

Place the full local USGS GeoJSON snapshot at:

```text
data/usgs_seed.geojson
```

This file is local-only and intentionally ignored by git. Generate or refresh it with:

```bash
python3 scripts/build_usgs_seed.py --end 2026-05-28 --min-magnitude 2.5 --chunk-days 365
```

The current local snapshot was generated from USGS for `1900-01-01` through `2026-05-28`
with `minMagnitude=2.5`. It contains 1,064,738 features and is about 726 MB.

The backend mounts this directory as `/data` and imports `/data/usgs_seed.geojson` on startup. After a successful import it stores the file SHA256 in `import_state`, so the same file is not re-imported on every restart. If the file changes, it is imported again with upserts.
