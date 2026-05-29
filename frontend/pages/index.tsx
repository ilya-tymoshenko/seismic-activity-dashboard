import Head from "next/head";
import ChartsPanel from "@/components/Dashboard/ChartsPanel";
import EarthquakeTable from "@/components/Dashboard/EarthquakeTable";
import FiltersPanel from "@/components/Dashboard/FiltersPanel";
import StatsCards from "@/components/Dashboard/StatsCards";
import AppLayout from "@/components/Layout/AppLayout";
import MapShell from "@/components/Map/MapShell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useDashboardData } from "@/hooks/use-dashboard-data";
import { formatDateTime, formatNumber } from "@/lib/format";

export default function HomePage() {
  const dashboard = useDashboardData();

  return (
    <>
      <Head>
        <title>Global Seismic Activity Analytics</title>
        <meta name="description" content="USGS earthquake analytics with PostGIS and Metabase" />
      </Head>
      <AppLayout
        busy={dashboard.busy}
        error={dashboard.error}
        actionJob={dashboard.actionJob}
        status={dashboard.status}
        onCancelAction={dashboard.handleCancelAction}
        onImport={dashboard.handleImport}
        onSync={dashboard.handleSync}
      >
        <div className="space-y-5">
          <StatsCards stats={dashboard.stats} />

          <section className="grid grid-cols-1 gap-5 xl:grid-cols-[340px_minmax(0,1fr)]">
            <div className="space-y-4">
              <FiltersPanel
                filters={dashboard.draftFilters}
                busy={dashboard.actionBusy}
                onApply={dashboard.applyFilters}
                onChange={dashboard.setDraftFilters}
                onImportFiltered={dashboard.handleImportFiltered}
                onReset={dashboard.resetFilters}
              />
              <StrongestEventCard stats={dashboard.stats} />
            </div>
            <MapShell
              earthquakes={dashboard.earthquakes}
              onBoundsChange={dashboard.setMapBounds}
              renderLimit={parseLimit(dashboard.appliedFilters.limit)}
            />
          </section>

          <ChartsPanel analytics={dashboard.analytics} />
          <EarthquakeTable earthquakes={dashboard.earthquakes} />
        </div>
      </AppLayout>
    </>
  );
}

function StrongestEventCard({ stats }: { stats: ReturnType<typeof useDashboardData>["stats"] }) {
  const event = stats?.strongestEvent;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Strongest event</CardTitle>
        <CardDescription>Highest magnitude in the current filter set</CardDescription>
      </CardHeader>
      <CardContent>
        {event ? (
          <div className="space-y-2">
            <div className="text-3xl font-semibold tracking-normal text-destructive">
              M {formatNumber(event.magnitude, 1)}
            </div>
            <div className="text-sm font-medium text-foreground">{event.place || "Unknown location"}</div>
            <div className="text-sm text-muted-foreground">{formatDateTime(event.time)}</div>
          </div>
        ) : (
          <div className="rounded-lg border border-dashed bg-muted/40 px-3 py-5 text-sm text-muted-foreground">
            No events loaded yet.
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function parseLimit(value?: string) {
  if (!value) {
    return undefined;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return undefined;
  }
  return parsed;
}
