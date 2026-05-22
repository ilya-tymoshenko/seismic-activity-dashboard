import type {
  AnalyticsResponse,
  Bounds,
  ClustersResponse,
  EarthquakesResponse,
  Filters,
  ImportSummary,
  StatsResponse
} from "./types";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080";

function buildQuery(filters: Filters = {}, bounds?: Bounds): string {
  const params = new URLSearchParams();

  add(params, "dateFrom", filters.dateFrom);
  add(params, "dateTo", filters.dateTo);
  add(params, "minMagnitude", filters.minMagnitude);
  add(params, "maxMagnitude", filters.maxMagnitude);
  add(params, "minDepth", filters.minDepth);
  add(params, "maxDepth", filters.maxDepth);
  add(params, "alert", filters.alert);
  add(params, "type", filters.type);
  add(params, "limit", filters.limit || "1000");

  if (filters.tsunamiOnly) {
    params.set("tsunami", "1");
  }
  if (bounds) {
    params.set("bbox", `${bounds.minLon},${bounds.minLat},${bounds.maxLon},${bounds.maxLat}`);
  }

  const query = params.toString();
  return query ? `?${query}` : "";
}

function add(params: URLSearchParams, key: string, value?: string) {
  if (value && value.trim() !== "") {
    params.set(key, value.trim());
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      Accept: "application/json",
      ...(init?.headers || {})
    }
  });

  if (!response.ok) {
    let message = `${response.status} ${response.statusText}`;
    try {
      const body = (await response.json()) as { error?: string };
      if (body.error) {
        message = body.error;
      }
    } catch {
      // keep default message
    }
    throw new Error(message);
  }

  return response.json() as Promise<T>;
}

export function fetchEarthquakes(filters: Filters, bounds?: Bounds) {
  return request<EarthquakesResponse>(`/api/earthquakes${buildQuery(filters, bounds)}`);
}

export function fetchStats(filters: Filters, bounds?: Bounds) {
  return request<StatsResponse>(`/api/stats${buildQuery(filters, bounds)}`);
}

export function fetchAnalytics(filters: Filters) {
  return request<AnalyticsResponse>(`/api/analytics${buildQuery(filters)}`);
}

export function fetchClusters(filters: Filters) {
  const params = new URLSearchParams();
  add(params, "dateFrom", filters.dateFrom);
  add(params, "dateTo", filters.dateTo);
  add(params, "minMagnitude", filters.minMagnitude || "4.5");
  params.set("eps", "2.0");
  params.set("minPoints", "10");
  return request<ClustersResponse>(`/api/clusters?${params.toString()}`);
}

export function syncData(feed = "2.5_day") {
  return request<ImportSummary>(`/api/sync?feed=${encodeURIComponent(feed)}`, {
    method: "POST"
  });
}

export function importHistory(days = 365, minMagnitude = 2.5, chunkDays = 30) {
  const params = new URLSearchParams({
    days: String(days),
    minMagnitude: String(minMagnitude),
    chunkDays: String(chunkDays)
  });
  return request<ImportSummary>(`/api/import/history?${params.toString()}`, {
    method: "POST"
  });
}
