import { useCallback, useEffect, useState } from "react";
import {
  fetchAnalytics,
  fetchEarthquakes,
  fetchStats,
  importHistory,
  syncData
} from "@/lib/api";
import type { AnalyticsResponse, Bounds, Earthquake, Filters, StatsResponse } from "@/lib/types";

export const defaultFilters: Filters = {
  minMagnitude: "2.5",
  limit: "1000"
};

export function useDashboardData() {
  const [draftFilters, setDraftFilters] = useState<Filters>(defaultFilters);
  const [appliedFilters, setAppliedFilters] = useState<Filters>(defaultFilters);
  const [bounds, setBounds] = useState<Bounds | undefined>();
  const [earthquakes, setEarthquakes] = useState<Earthquake[]>([]);
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [analytics, setAnalytics] = useState<AnalyticsResponse | null>(null);
  const [summaryBusy, setSummaryBusy] = useState(false);
  const [mapBusy, setMapBusy] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("Dashboard ready. Sync or import USGS data to populate the database.");

  const loadSummary = useCallback(async (filters: Filters) => {
    setSummaryBusy(true);
    setError(null);
    try {
      const [nextStats, nextAnalytics] = await Promise.all([
        fetchStats(filters),
        fetchAnalytics(filters)
      ]);
      setStats(nextStats);
      setAnalytics(nextAnalytics);
      setStatus(`Loaded analytics for ${nextStats.totalEvents.toLocaleString()} events.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load analytics");
    } finally {
      setSummaryBusy(false);
    }
  }, []);

  const loadEarthquakes = useCallback(async (filters: Filters, nextBounds?: Bounds) => {
    setMapBusy(true);
    setError(null);
    try {
      const response = await fetchEarthquakes(filters, nextBounds);
      setEarthquakes(response.data);
      setStatus(`Map loaded ${response.meta.returned.toLocaleString()} of max ${response.meta.limit.toLocaleString()} events.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load earthquakes");
    } finally {
      setMapBusy(false);
    }
  }, []);

  useEffect(() => {
    void loadSummary(appliedFilters);
  }, [appliedFilters, loadSummary]);

  useEffect(() => {
    void loadEarthquakes(appliedFilters, bounds);
  }, [appliedFilters, bounds, loadEarthquakes]);

  const setMapBounds = useCallback((nextBounds: Bounds) => {
    setBounds((current) => {
      if (
        current &&
        current.minLon === nextBounds.minLon &&
        current.minLat === nextBounds.minLat &&
        current.maxLon === nextBounds.maxLon &&
        current.maxLat === nextBounds.maxLat
      ) {
        return current;
      }
      return nextBounds;
    });
  }, []);

  const applyFilters = useCallback(() => {
    setAppliedFilters({ ...draftFilters });
  }, [draftFilters]);

  const resetFilters = useCallback(() => {
    setDraftFilters(defaultFilters);
    setAppliedFilters(defaultFilters);
  }, []);

  const refreshAll = useCallback(async () => {
    await Promise.all([
      loadSummary(appliedFilters),
      loadEarthquakes(appliedFilters, bounds)
    ]);
  }, [appliedFilters, bounds, loadEarthquakes, loadSummary]);

  const handleSync = useCallback(async () => {
    setActionBusy(true);
    setError(null);
    setStatus("Syncing recent USGS feed...");
    try {
      const summary = await syncData("2.5_day");
      setStatus(`Sync completed: fetched ${summary.fetched}, processed ${summary.processed}, skipped ${summary.skipped}, errors ${summary.errors}.`);
      await refreshAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sync failed");
    } finally {
      setActionBusy(false);
    }
  }, [refreshAll]);

  const handleImport = useCallback(async () => {
    setActionBusy(true);
    setError(null);
    setStatus("Importing 10 years of USGS history...");
    try {
      const summary = await importHistory(3650, 2.5, 30);
      setStatus(`History import completed: chunks ${summary.chunks || 0}, fetched ${summary.fetched}, processed ${summary.processed}, skipped ${summary.skipped}, errors ${summary.errors}.`);
      await refreshAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Historical import failed");
    } finally {
      setActionBusy(false);
    }
  }, [refreshAll]);

  const busy = summaryBusy || mapBusy || actionBusy;

  return {
    actionBusy,
    analytics,
    applyFilters,
    busy,
    draftFilters,
    earthquakeCount: earthquakes.length,
    earthquakes,
    error,
    handleImport,
    handleSync,
    mapBusy,
    resetFilters,
    setDraftFilters,
    setMapBounds,
    stats,
    status,
    summaryBusy
  };
}
