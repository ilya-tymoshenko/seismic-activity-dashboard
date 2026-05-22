import { Activity, Gauge, RadioTower, Sigma, Timer, Waves, Zap } from "lucide-react";
import type { StatsResponse } from "../../lib/types";
import { formatInteger, formatNumber } from "../../lib/format";

type Props = {
  stats: StatsResponse | null;
};

const cards = [
  { key: "totalEvents", label: "Total Events", icon: Activity, tone: "bg-ocean" },
  { key: "maxMagnitude", label: "Max Magnitude", icon: Zap, tone: "bg-coral" },
  { key: "avgMagnitude", label: "Average Magnitude", icon: Sigma, tone: "bg-mint" },
  { key: "avgDepth", label: "Average Depth", icon: Gauge, tone: "bg-amber" },
  { key: "tsunamiEvents", label: "Tsunami Events", icon: Waves, tone: "bg-[#7c3aed]" },
  { key: "eventsLast24h", label: "Events Last 24h", icon: Timer, tone: "bg-[#0f766e]" },
  { key: "eventsLast7d", label: "Events Last 7d", icon: RadioTower, tone: "bg-[#be123c]" }
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
          <article key={card.key} className="rounded-lg border border-slate-200 bg-panel p-4 shadow-panel">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-xs font-semibold uppercase text-slate-500">{card.label}</span>
              <span className={`grid h-8 w-8 place-items-center rounded-lg text-white ${card.tone}`}>
                <Icon size={17} />
              </span>
            </div>
            <div className="text-2xl font-bold text-ink">{value}{suffix}</div>
          </article>
        );
      })}
    </section>
  );
}
