import { Activity, Gauge, RadioTower, Sigma, Timer, Waves, Zap } from "lucide-react";
import type { StatsResponse } from "../../lib/types";
import { formatInteger, formatNumber } from "../../lib/format";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type Props = {
  stats: StatsResponse | null;
};

const cards = [
  { key: "totalEvents", label: "Total Events", icon: Activity, tone: "bg-primary text-primary-foreground" },
  { key: "maxMagnitude", label: "Max Magnitude", icon: Zap, tone: "bg-destructive text-destructive-foreground" },
  { key: "avgMagnitude", label: "Average Magnitude", icon: Sigma, tone: "bg-mint text-white" },
  { key: "avgDepth", label: "Average Depth", icon: Gauge, tone: "bg-amber text-foreground" },
  { key: "tsunamiEvents", label: "Tsunami Events", icon: Waves, tone: "bg-[#7c3aed] text-white" },
  { key: "eventsLast24h", label: "Events Last 24h", icon: Timer, tone: "bg-[#0f766e] text-white" },
  { key: "eventsLast7d", label: "Events Last 7d", icon: RadioTower, tone: "bg-[#be123c] text-white" }
] as const;

export default function StatsCards({ stats }: Props) {
  return (
    <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4 2xl:grid-cols-7">
      {cards.map((card) => {
        const Icon = card.icon;
        const rawValue = stats?.[card.key];
        const value = card.key.includes("Magnitude") || card.key.includes("Depth")
          ? formatNumber(rawValue as number | null | undefined)
          : formatInteger(rawValue as number | null | undefined);
        const suffix = card.key === "avgDepth" ? " km" : "";
        return (
          <Card key={card.key} size="sm">
            <CardHeader>
              <CardTitle className="text-xs font-semibold uppercase text-muted-foreground">{card.label}</CardTitle>
              <CardAction>
                <span className={`grid size-8 place-items-center rounded-lg ${card.tone}`}>
                <Icon size={17} />
              </span>
              </CardAction>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-semibold tracking-normal text-foreground">{value}{suffix}</div>
            </CardContent>
          </Card>
        );
      })}
    </section>
  );
}
