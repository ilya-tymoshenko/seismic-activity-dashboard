#!/usr/bin/env python3
"""Build a local USGS GeoJSON seed file for offline startup imports."""

from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import UTC, date, datetime, time as datetime_time, timedelta
from pathlib import Path
from typing import Any


COUNT_URL = "https://earthquake.usgs.gov/fdsnws/event/1/count"
QUERY_URL = "https://earthquake.usgs.gov/fdsnws/event/1/query"
USER_AGENT = "seismic-activity-dashboard-seed-builder/1.0"
USGS_MAX_QUERY_LIMIT = 20000


def parse_date(value: str) -> datetime:
    parsed = datetime.fromisoformat(value)
    if parsed.tzinfo is None:
        if "T" not in value:
            return datetime.combine(parsed.date(), datetime_time.min, tzinfo=UTC)
        return parsed.replace(tzinfo=UTC)
    return parsed.astimezone(UTC)


def format_time(value: datetime) -> str:
    return value.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%S")


def request_url(url: str, timeout: int, retries: int, pause: float) -> bytes:
    last_error: Exception | None = None
    for attempt in range(1, retries + 1):
        request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                return response.read()
        except (TimeoutError, urllib.error.URLError, urllib.error.HTTPError) as error:
            last_error = error
            if attempt == retries:
                break
            wait_seconds = pause * attempt
            print(f"request failed ({error}); retrying in {wait_seconds:.1f}s", file=sys.stderr, flush=True)
            time.sleep(wait_seconds)
    assert last_error is not None
    raise last_error


def build_params(start: datetime, end: datetime, min_magnitude: float) -> dict[str, str]:
    return {
        "starttime": format_time(start),
        "endtime": format_time(end),
        "minmagnitude": str(min_magnitude),
    }


def count_events(start: datetime, end: datetime, min_magnitude: float, timeout: int, retries: int, pause: float) -> int:
    params = urllib.parse.urlencode(build_params(start, end, min_magnitude))
    payload = request_url(f"{COUNT_URL}?{params}", timeout, retries, pause)
    return int(payload.decode("utf-8").strip())


def fetch_events(
    start: datetime,
    end: datetime,
    min_magnitude: float,
    limit: int,
    timeout: int,
    retries: int,
    pause: float,
) -> list[dict[str, Any]]:
    params = build_params(start, end, min_magnitude)
    params.update({"format": "geojson", "orderby": "time-asc", "limit": str(limit)})
    payload = request_url(f"{QUERY_URL}?{urllib.parse.urlencode(params)}", timeout, retries, pause)
    collection = json.loads(payload)
    return collection.get("features", [])


def split_ranges(
    start: datetime,
    end: datetime,
    min_magnitude: float,
    max_per_request: int,
    timeout: int,
    retries: int,
    pause: float,
) -> list[tuple[datetime, datetime, int]]:
    count = count_events(start, end, min_magnitude, timeout, retries, pause)
    if count <= max_per_request:
        return [(start, end, count)]

    midpoint = start + (end - start) / 2
    if midpoint <= start or midpoint >= end:
        raise RuntimeError(
            f"cannot split {format_time(start)}..{format_time(end)} with {count} events"
        )
    return [
        *split_ranges(start, midpoint, min_magnitude, max_per_request, timeout, retries, pause),
        *split_ranges(midpoint, end, min_magnitude, max_per_request, timeout, retries, pause),
    ]


def build_seed(args: argparse.Namespace) -> int:
    validate_args(args)

    start = parse_date(args.start)
    end = parse_date(args.end) if args.end else datetime.combine(date.today(), datetime_time.min, tzinfo=UTC)
    if not start < end:
        raise ValueError("start must be earlier than end")

    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    temp_output = output.with_suffix(output.suffix + ".tmp")

    metadata = {
        "generatedAt": datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "source": "USGS FDSN Event API",
        "sourceUrl": QUERY_URL,
        "startTime": format_time(start),
        "endTime": format_time(end),
        "minMagnitude": args.min_magnitude,
        "chunkDays": args.chunk_days,
        "note": "Generated locally; keep this file outside git.",
    }

    written = 0
    fetched = 0
    chunks = 0
    seen_ids: set[str] = set()
    current = start

    with temp_output.open("w", encoding="utf-8") as file:
        file.write('{"type":"FeatureCollection","metadata":')
        json.dump(metadata, file, separators=(",", ":"))
        file.write(',"features":[')

        while current < end:
            chunk_end = min(current + timedelta(days=args.chunk_days), end)
            ranges = split_ranges(
                current,
                chunk_end,
                args.min_magnitude,
                args.max_per_request,
                args.timeout,
                args.retries,
                args.pause,
            )
            for range_start, range_end, expected_count in ranges:
                chunks += 1
                label = f"{format_time(range_start)}..{format_time(range_end)}"
                if expected_count == 0:
                    print(f"[{chunks}] {label}: 0", flush=True)
                    continue
                features = fetch_events(
                    range_start,
                    range_end,
                    args.min_magnitude,
                    args.max_per_request,
                    args.timeout,
                    args.retries,
                    args.pause,
                )
                if len(features) != expected_count:
                    raise RuntimeError(
                        "USGS range response is incomplete: "
                        f"{label} expected={expected_count} fetched={len(features)}. "
                        "Lower --max-per-request and rerun to avoid writing a partial seed."
                    )
                fetched += len(features)
                for feature in features:
                    feature_id = feature.get("id")
                    if feature_id:
                        if feature_id in seen_ids:
                            continue
                        seen_ids.add(feature_id)
                    if written:
                        file.write(",")
                    json.dump(feature, file, separators=(",", ":"))
                    written += 1
                print(
                    f"[{chunks}] {label}: expected={expected_count} fetched={len(features)} written={written}",
                    flush=True,
                )
                if args.pause > 0:
                    time.sleep(args.pause)
            current = chunk_end

        file.write("]}\n")

    temp_output.replace(output)
    print(f"done: fetched={fetched} written={written} output={output}", flush=True)
    return written


def validate_args(args: argparse.Namespace) -> None:
    if args.chunk_days <= 0:
        raise ValueError("--chunk-days must be positive")
    if args.max_per_request <= 0:
        raise ValueError("--max-per-request must be positive")
    if args.max_per_request > USGS_MAX_QUERY_LIMIT:
        raise ValueError(f"--max-per-request must be <= {USGS_MAX_QUERY_LIMIT}")
    if args.timeout <= 0:
        raise ValueError("--timeout must be positive")
    if args.retries <= 0:
        raise ValueError("--retries must be positive")
    if args.pause < 0:
        raise ValueError("--pause must be non-negative")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", default="data/usgs_seed.geojson")
    parser.add_argument("--start", default="1900-01-01")
    parser.add_argument("--end", default="")
    parser.add_argument("--min-magnitude", type=float, default=2.5)
    parser.add_argument("--chunk-days", type=int, default=30)
    parser.add_argument("--max-per-request", type=int, default=18000)
    parser.add_argument("--timeout", type=int, default=90)
    parser.add_argument("--retries", type=int, default=4)
    parser.add_argument("--pause", type=float, default=0.15)
    build_seed(parser.parse_args())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
