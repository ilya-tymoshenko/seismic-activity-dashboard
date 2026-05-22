import { Filter, RotateCcw, SlidersHorizontal } from "lucide-react";
import type { ReactNode } from "react";
import type { Filters } from "../../lib/types";

type Props = {
  filters: Filters;
  onChange: (filters: Filters) => void;
  onApply: () => void;
  onReset: () => void;
};

export default function FiltersPanel({ filters, onChange, onApply, onReset }: Props) {
  const update = (key: keyof Filters, value: string | boolean) => {
    onChange({ ...filters, [key]: value });
  };

  return (
    <aside className="rounded-lg border border-slate-200 bg-panel p-4 shadow-panel">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <SlidersHorizontal size={18} className="text-ocean" />
          <h2 className="text-base font-bold text-ink">Filters</h2>
        </div>
        <span className="rounded-lg bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-600">bbox aware</span>
      </div>

      <div className="space-y-3">
        <Field label="Date from">
          <input className="input" type="date" value={filters.dateFrom || ""} onChange={(event) => update("dateFrom", event.target.value)} />
        </Field>
        <Field label="Date to">
          <input className="input" type="date" value={filters.dateTo || ""} onChange={(event) => update("dateTo", event.target.value)} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Min mag">
            <input className="input" min="0" step="0.1" type="number" value={filters.minMagnitude || ""} onChange={(event) => update("minMagnitude", event.target.value)} />
          </Field>
          <Field label="Max mag">
            <input className="input" min="0" step="0.1" type="number" value={filters.maxMagnitude || ""} onChange={(event) => update("maxMagnitude", event.target.value)} />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Min depth">
            <input className="input" step="1" type="number" value={filters.minDepth || ""} onChange={(event) => update("minDepth", event.target.value)} />
          </Field>
          <Field label="Max depth">
            <input className="input" step="1" type="number" value={filters.maxDepth || ""} onChange={(event) => update("maxDepth", event.target.value)} />
          </Field>
        </div>
        <Field label="Alert">
          <select className="input" value={filters.alert || ""} onChange={(event) => update("alert", event.target.value)}>
            <option value="">All alerts</option>
            <option value="green">Green</option>
            <option value="yellow">Yellow</option>
            <option value="orange">Orange</option>
            <option value="red">Red</option>
          </select>
        </Field>
        <Field label="Limit">
          <select className="input" value={filters.limit || "1000"} onChange={(event) => update("limit", event.target.value)}>
            <option value="500">500</option>
            <option value="1000">1000</option>
            <option value="2500">2500</option>
            <option value="5000">5000</option>
          </select>
        </Field>

        <label className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-medium text-slate-700">
          <span>Tsunami only</span>
          <input checked={Boolean(filters.tsunamiOnly)} className="h-4 w-4 accent-coral" type="checkbox" onChange={(event) => update("tsunamiOnly", event.target.checked)} />
        </label>
        <label className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-medium text-slate-700">
          <span>Analytical clusters</span>
          <input checked={Boolean(filters.showClusters)} className="h-4 w-4 accent-ocean" type="checkbox" onChange={(event) => update("showClusters", event.target.checked)} />
        </label>

        <div className="grid grid-cols-2 gap-2 pt-2">
          <button className="inline-flex items-center justify-center gap-2 rounded-lg bg-ocean px-3 py-2 text-sm font-semibold text-white hover:bg-[#125b7f]" type="button" onClick={onApply}>
            <Filter size={16} />
            Apply
          </button>
          <button className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50" type="button" onClick={onReset}>
            <RotateCcw size={16} />
            Reset
          </button>
        </div>
      </div>
    </aside>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block text-sm font-semibold text-slate-600">
      <span className="mb-1 block">{label}</span>
      {children}
    </label>
  );
}
