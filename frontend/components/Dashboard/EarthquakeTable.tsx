import type { Earthquake } from "../../lib/types";
import { formatDateTime, formatNumber } from "../../lib/format";

type Props = {
  earthquakes: Earthquake[];
};

export default function EarthquakeTable({ earthquakes }: Props) {
  return (
    <section className="rounded-lg border border-slate-200 bg-panel shadow-panel">
      <div className="border-b border-slate-200 px-4 py-3">
        <h2 className="text-base font-bold text-ink">Recent Earthquakes</h2>
      </div>
      <div className="max-h-[420px] overflow-auto">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="sticky top-0 bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-3">Time</th>
              <th className="px-4 py-3">Mag</th>
              <th className="px-4 py-3">Depth</th>
              <th className="px-4 py-3">Place</th>
              <th className="px-4 py-3">Tsunami</th>
              <th className="px-4 py-3">Alert</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {earthquakes.slice(0, 80).map((earthquake) => (
              <tr key={earthquake.id} className="hover:bg-slate-50">
                <td className="whitespace-nowrap px-4 py-3 text-slate-600">{formatDateTime(earthquake.time)}</td>
                <td className="px-4 py-3 font-bold text-ink">{formatNumber(earthquake.magnitude, 1)}</td>
                <td className="px-4 py-3 text-slate-700">{formatNumber(earthquake.depth, 1)} km</td>
                <td className="min-w-[260px] px-4 py-3 text-slate-700">{earthquake.place || "Unknown"}</td>
                <td className="px-4 py-3">{earthquake.tsunami === 1 ? "Yes" : "No"}</td>
                <td className="px-4 py-3">
                  <span className="rounded-lg bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-600">{earthquake.alert || "n/a"}</span>
                </td>
              </tr>
            ))}
            {earthquakes.length === 0 && (
              <tr>
                <td className="px-4 py-8 text-center text-slate-500" colSpan={6}>No events for current filters.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
