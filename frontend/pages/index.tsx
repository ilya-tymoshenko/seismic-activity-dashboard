import Head from "next/head";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ChartsPanel from "../components/Dashboard/ChartsPanel";
import EarthquakeTable from "../components/Dashboard/EarthquakeTable";
import FiltersPanel from "../components/Dashboard/FiltersPanel";
import StatsCards from "../components/Dashboard/StatsCards";
import AppLayout from "../components/Layout/AppLayout";
import MapShell from "../components/Map/MapShell";
import {
  fetchAnalytics,
  fetchClusters,
  fetchEarthquakes,
  fetchStats,
  importHistory,
  syncData
} from "../lib/api";
import type { AnalyticsResponse, Bounds, Cluster, Earthquake, Filters, StatsResponse } from "../lib/types";

const defaultFilters: Filters = {
  minMagnitude: "2.5",
  limit: "1000",
  showClusters: true
};

export default function HomePage() {
  const [draftFilters, setDraftFilters] = useState<Filters>(defaultFilters);
  const [appliedFilters, setAppliedFilters] = useState<Filters>(defaultFilters);
  const [bounds, setBounds] = useState<Bounds | undefined>();
  const [earthquakes, setEarthquakes] = useState<Earthquake[]>([]);
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [analytics, setAnalytics] = useState<AnalyticsResponse | null>(null);
  const [clusters, setClusters] = useState<Cluster[]>([]);
  const [busy, setBusy] = useState(false);
  const [mapBusy, setMapBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("Dashboard ready. Sync or import USGS data to populate the database.");
  const clusterRequestSeq = useRef(0);

  const showClusters = Boolean(appliedFilters.showClusters);

  const loadSummary = useCallback(async (filters: Filters) => {
    setBusy(true);
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
      setBusy(false);
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

  const loadClusters = useCallback(async (filters: Filters, nextBounds?: Bounds) => {
    const requestId = ++clusterRequestSeq.current;
    if (!filters.showClusters) {
      setClusters([]);
      return;
    }
    try {
      const response = await fetchClusters(filters, nextBounds);
      if (requestId === clusterRequestSeq.current) {
        setClusters(response.data);
      }
    } catch (err) {
      if (requestId === clusterRequestSeq.current) {
        setError(err instanceof Error ? err.message : "Failed to load clusters");
      }
    }
  }, []);

  useEffect(() => {
    void loadSummary(appliedFilters);
  }, [appliedFilters, loadSummary]);

  useEffect(() => {
    void loadClusters(appliedFilters, bounds);
  }, [appliedFilters, bounds, loadClusters]);

  useEffect(() => {
    void loadEarthquakes(appliedFilters, bounds);
  }, [appliedFilters, bounds, loadEarthquakes]);

  const handleBoundsChange = useCallback((nextBounds: Bounds) => {
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

  const applyFilters = () => {
    setAppliedFilters({ ...draftFilters });
  };

  const resetFilters = () => {
    setDraftFilters(defaultFilters);
    setAppliedFilters(defaultFilters);
  };

  const refreshAll = useCallback(async () => {
    await Promise.all([
      loadSummary(appliedFilters),
      loadEarthquakes(appliedFilters, bounds),
      loadClusters(appliedFilters, bounds)
    ]);
  }, [appliedFilters, bounds, loadClusters, loadEarthquakes, loadSummary]);

  const handleSync = async () => {
    setBusy(true);
    setError(null);
    try {
      const summary = await syncData("2.5_day");
      setStatus(`Sync completed: fetched ${summary.fetched}, processed ${summary.processed}, skipped ${summary.skipped}, errors ${summary.errors}.`);
      await refreshAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sync failed");
    } finally {
      setBusy(false);
    }
  };

  const handleImport = async () => {
    setBusy(true);
    setError(null);
    try {
      const summary = await importHistory(365, 2.5, 30);
      setStatus(`History import completed: chunks ${summary.chunks || 0}, fetched ${summary.fetched}, processed ${summary.processed}, errors ${summary.errors}.`);
      await refreshAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Historical import failed");
    } finally {
      setBusy(false);
    }
  };

  const visibleClusters = useMemo(() => (showClusters ? clusters : []), [clusters, showClusters]);

  return (
    <>
      <Head>
        <title>Global Seismic Activity Analytics</title>
        <meta name="description" content="USGS earthquake analytics with PostGIS clusters" />
      </Head>
      <AppLayout busy={busy || mapBusy} error={error} status={status} onImport={handleImport} onSync={handleSync}>
        <div className="space-y-5">
          <StatsCards stats={stats} />

          <section className="grid grid-cols-1 gap-5 xl:grid-cols-[320px_minmax(0,1fr)]">
            <div className="space-y-4">
              <FiltersPanel filters={draftFilters} onApply={applyFilters} onChange={setDraftFilters} onReset={resetFilters} />
              <div className="rounded-lg border border-slate-200 bg-panel p-4 text-sm text-slate-600 shadow-panel">
                <div className="mb-2 font-bold text-ink">Strongest event</div>
                {stats?.strongestEvent ? (
                  <div className="space-y-1">
                    <div className="text-lg font-bold text-coral">M {stats.strongestEvent.magnitude ?? "n/a"}</div>
                    <div>{stats.strongestEvent.place}</div>
                  </div>
                ) : (
                  <div>No events loaded yet.</div>
                )}
              </div>
            </div>
            <MapShell
              clusters={visibleClusters}
              earthquakes={earthquakes}
              onBoundsChange={handleBoundsChange}
              showClusters={showClusters}
            />
          </section>

          <ChartsPanel analytics={analytics} />
          <EarthquakeTable earthquakes={earthquakes} />
        </div>
      </AppLayout>
    </>
  );
}
