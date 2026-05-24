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

export default function ChartsPanel({ analytics }: Props) {
  const empty = !analytics;

  return (
    <section className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      <ChartCard title="Events by day">
        {empty ? <EmptyChart /> : (
          <ResponsiveContainer height={260} width="100%">
            <LineChart data={analytics.eventsByDay}>
              <CartesianGrid stroke="#e5e7eb" strokeDasharray="3 3" />
              <XAxis dataKey="date" minTickGap={24} tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip />
              <Line dataKey="count" dot={false} stroke="var(--chart-1)" strokeWidth={2} type="monotone" />
              <Line dataKey="avgMagnitude" dot={false} stroke="var(--chart-2)" strokeWidth={2} type="monotone" yAxisId={0} />
            </LineChart>
          </ResponsiveContainer>
        )}
      </ChartCard>

      <ChartCard title="Magnitude distribution">
        {empty ? <EmptyChart /> : (
          <ResponsiveContainer height={260} width="100%">
            <BarChart data={analytics.magnitudeDistribution}>
              <CartesianGrid stroke="#e5e7eb" strokeDasharray="3 3" />
              <XAxis dataKey="category" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip />
              <Bar dataKey="count" fill="var(--chart-2)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </ChartCard>

      <ChartCard title="Depth distribution">
        {empty ? <EmptyChart /> : (
          <ResponsiveContainer height={260} width="100%">
            <BarChart data={analytics.depthDistribution}>
              <CartesianGrid stroke="#e5e7eb" strokeDasharray="3 3" />
              <XAxis dataKey="category" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip />
              <Bar dataKey="count" fill="var(--chart-3)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </ChartCard>

      <ChartCard title="Top active places">
        {empty ? <EmptyChart /> : (
          <ResponsiveContainer height={260} width="100%">
            <BarChart data={analytics.topPlaces} layout="vertical" margin={{ left: 24 }}>
              <CartesianGrid stroke="#e5e7eb" strokeDasharray="3 3" />
              <XAxis type="number" tick={{ fontSize: 11 }} />
              <YAxis dataKey="place" tick={{ fontSize: 10 }} type="category" width={130} />
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
      <Skeleton className="h-[210px] w-full" />
      <div className="text-center text-sm text-muted-foreground">No data loaded</div>
    </div>
  );
}
