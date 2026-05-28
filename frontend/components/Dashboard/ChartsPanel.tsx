import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import type { ReactNode } from "react";
import type { AnalyticsResponse } from "../../lib/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

type Props = {
  analytics: AnalyticsResponse | null;
};

const CHART_HEIGHT = 360;
const CHART_WIDTH = "100%";
const CHART_GRID_PROPS = { stroke: "#e5e7eb", strokeDasharray: "3 3" as const };
const LINE_TICK_PROPS = { fontSize: 11 };
const BAR_TICK_PROPS = { fontSize: 12 };
const SMALL_TICK_PROPS = { fontSize: 10 };
const TOP_PLACES_MARGIN = { left: 24 };
const LINE_STROKE_WIDTH = 2;
const EMPTY_CHART_CLASS = "h-[210px] w-full";

export default function ChartsPanel({ analytics }: Props) {
  const empty = !analytics;

  return (
    <section className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      <ChartCard title="Events by day">
        {empty ? <EmptyChart /> : (
          <ResponsiveContainer height={CHART_HEIGHT} width={CHART_WIDTH}>
            <LineChart data={analytics.eventsByDay}>
              <CartesianGrid {...CHART_GRID_PROPS} />
              <XAxis dataKey="date" minTickGap={24} tick={LINE_TICK_PROPS} />
              <YAxis tick={LINE_TICK_PROPS} />
              <Tooltip />
              <Line dataKey="count" dot={false} stroke="var(--chart-1)" strokeWidth={LINE_STROKE_WIDTH} type="monotone" />
              <Line dataKey="avgMagnitude" dot={false} stroke="var(--chart-2)" strokeWidth={LINE_STROKE_WIDTH} type="monotone" yAxisId={0} />
            </LineChart>
          </ResponsiveContainer>
        )}
      </ChartCard>

      <ChartCard title="Magnitude distribution">
        {empty ? <EmptyChart /> : (
          <ResponsiveContainer height={CHART_HEIGHT} width={CHART_WIDTH}>
            <BarChart data={analytics.magnitudeDistribution}>
              <CartesianGrid {...CHART_GRID_PROPS} />
              <XAxis dataKey="category" tick={BAR_TICK_PROPS} />
              <YAxis tick={LINE_TICK_PROPS} />
              <Tooltip />
              <Bar dataKey="count" fill="var(--chart-2)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </ChartCard>

      <ChartCard title="Depth distribution">
        {empty ? <EmptyChart /> : (
          <ResponsiveContainer height={CHART_HEIGHT} width={CHART_WIDTH}>
            <BarChart data={analytics.depthDistribution}>
              <CartesianGrid {...CHART_GRID_PROPS} />
              <XAxis dataKey="category" tick={BAR_TICK_PROPS} />
              <YAxis tick={LINE_TICK_PROPS} />
              <Tooltip />
              <Bar dataKey="count" fill="var(--chart-3)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </ChartCard>

      <ChartCard title="Top active places">
        {empty ? <EmptyChart /> : (
          <ResponsiveContainer height={CHART_HEIGHT} width={CHART_WIDTH}>
            <BarChart data={analytics.topPlaces} layout="vertical" margin={TOP_PLACES_MARGIN}>
              <CartesianGrid {...CHART_GRID_PROPS} />
              <XAxis type="number" tick={LINE_TICK_PROPS} />
              <YAxis dataKey="place" tick={SMALL_TICK_PROPS} type="category" width={130} />
              <Tooltip />
              <Bar dataKey="count" fill="var(--chart-4)" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </ChartCard>
    </section>
  );
}

function ChartCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function EmptyChart() {
  return (
    <div className="space-y-3">
      <Skeleton className={EMPTY_CHART_CLASS} />
      <div className="text-center text-sm text-muted-foreground">No data loaded</div>
    </div>
  );
}
