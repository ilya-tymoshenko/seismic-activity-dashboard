import { useCallback, useEffect, useState } from "react";
import {
  cancelImportJob,
  fetchAnalytics,
  fetchEarthquakes,
  fetchImportJob,
  fetchStats,
  importFilteredData,
  importHistory,
  syncData
} from "@/lib/api";
import type { AnalyticsResponse, Bounds, Earthquake, Filters, ImportJobStatus, StatsResponse } from "@/lib/types";

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
  const [actionJob, setActionJob] = useState<ImportJobStatus | null>(null);
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

  const waitForJob = useCallback(async (jobId: string) => {
    for (;;) {
      await delay(700);
      const nextJob = await fetchImportJob(jobId);
      setActionJob(nextJob);
      setStatus(formatJobStatus(nextJob));

      if (nextJob.status === "succeeded") {
        return nextJob;
      }
      if (nextJob.status === "canceled") {
        return nextJob;
      }
      if (nextJob.status === "failed") {
        throw new Error(nextJob.error || `${nextJob.label} failed`);
      }
    }
  }, []);

  const handleSync = useCallback(async () => {
    setActionBusy(true);
    setActionJob(null);
    setError(null);
    setStatus("Starting sync...");
    try {
      const started = await syncData("2.5_day");
      setActionJob(started.status);
      setStatus(formatJobStatus(started.status));
      const job = await waitForJob(started.jobId);
      setStatus(formatTerminalJob(job));
      await refreshAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sync failed");
    } finally {
      setActionBusy(false);
    }
  }, [refreshAll, waitForJob]);

  const handleImport = useCallback(async () => {
    setActionBusy(true);
    setActionJob(null);
    setError(null);
    setStatus("Starting history import...");
    try {
      const started = await importHistory(3650, 2.5, 30);
      setActionJob(started.status);
      setStatus(formatJobStatus(started.status));
      const job = await waitForJob(started.jobId);
      setStatus(formatTerminalJob(job));
      await refreshAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Historical import failed");
    } finally {
      setActionBusy(false);
    }
  }, [refreshAll, waitForJob]);

  const handleImportFiltered = useCallback(async () => {
    if (!draftFilters.dateFrom || !draftFilters.dateTo) {
      setError("Date from and Date to are required to load filtered USGS data");
      return;
    }
    setActionBusy(true);
    setActionJob(null);
    setError(null);
    setStatus("Starting filtered USGS import...");
    try {
      const nextFilters = { ...draftFilters };
      setAppliedFilters(nextFilters);
      const started = await importFilteredData(nextFilters, bounds, 30);
      setActionJob(started.status);
      setStatus(formatJobStatus(started.status));
      const job = await waitForJob(started.jobId);
      setStatus(formatTerminalJob(job));
      await Promise.all([
        loadSummary(nextFilters),
        loadEarthquakes(nextFilters, bounds)
      ]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Filtered USGS import failed");
    } finally {
      setActionBusy(false);
    }
  }, [bounds, draftFilters, loadEarthquakes, loadSummary, waitForJob]);

  const handleCancelAction = useCallback(async () => {
    if (!actionJob || !isActiveJob(actionJob)) {
      return;
    }
    setError(null);
    try {
      const canceled = await cancelImportJob(actionJob.id);
      setActionJob(canceled);
      setStatus(formatJobStatus(canceled));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Cancel failed");
    }
  }, [actionJob]);

  const busy = summaryBusy || mapBusy || actionBusy;

  return {
    actionBusy,
    actionJob,
    analytics,
    applyFilters,
    busy,
    draftFilters,
    earthquakeCount: earthquakes.length,
    earthquakes,
    error,
    handleCancelAction,
    handleImportFiltered,
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

function delay(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function formatJobStatus(job: ImportJobStatus) {
  const progress = Math.round(job.progress);
  const step =
    job.totalSteps > 0
      ? ` ${job.currentStep.toLocaleString()}/${job.totalSteps.toLocaleString()}`
      : "";
  return `${job.label}: ${progress}%${step} - ${job.message}`;
}

function formatTerminalJob(job: ImportJobStatus) {
  const summary = job.summary;
  if (job.status === "canceled") {
    return `${job.label} canceled: fetched ${summary.fetched.toLocaleString()}, processed ${summary.processed.toLocaleString()}, skipped ${summary.skipped.toLocaleString()}, errors ${summary.errors.toLocaleString()}.`;
  }
  return `${job.label} completed: fetched ${summary.fetched.toLocaleString()}, processed ${summary.processed.toLocaleString()}, skipped ${summary.skipped.toLocaleString()}, errors ${summary.errors.toLocaleString()}.`;
}

function isActiveJob(job: ImportJobStatus) {
  return job.status === "queued" || job.status === "running" || job.status === "canceling";
}
