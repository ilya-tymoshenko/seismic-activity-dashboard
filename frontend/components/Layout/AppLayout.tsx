import { Activity, BarChart3, Database, RefreshCw } from "lucide-react";
import type { ReactNode } from "react";

type Props = {
  children: ReactNode;
  busy?: boolean;
  status?: string;
  error?: string | null;
  onSync: () => void;
  onImport: () => void;
};

export default function AppLayout({ children, busy, status, error, onSync, onImport }: Props) {
  const metabaseUrl = process.env.NEXT_PUBLIC_METABASE_URL || "http://localhost:3001";

  return (
    <main className="min-h-screen bg-canvas">
      <header className="border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1800px] flex-col gap-4 px-4 py-4 md:flex-row md:items-center md:justify-between md:px-6">
          <div>
            <div className="flex items-center gap-3">
              <div className="grid h-10 w-10 place-items-center rounded-lg bg-coral text-white shadow-panel">
                <Activity size={22} />
              </div>
              <div>
                <h1 className="text-xl font-bold tracking-normal text-ink md:text-2xl">Global Seismic Activity Analytics</h1>
                <p className="text-sm text-slate-600">USGS Earthquake Catalog + PostGIS + Metabase</p>
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              className="inline-flex items-center gap-2 rounded-lg bg-ocean px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-[#125b7f] disabled:cursor-not-allowed disabled:opacity-60"
              disabled={busy}
              onClick={onSync}
              type="button"
              title="Sync recent USGS data"
            >
              <RefreshCw size={17} className={busy ? "animate-spin" : ""} />
              Sync Data
            </button>
            <button
              className="inline-flex items-center gap-2 rounded-lg bg-ink px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-black disabled:cursor-not-allowed disabled:opacity-60"
              disabled={busy}
              onClick={onImport}
              type="button"
              title="Import historical USGS data"
            >
              <Database size={17} />
              Import History
            </button>
            <a
              className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50"
              href={metabaseUrl}
              rel="noreferrer"
              target="_blank"
              title="Open Metabase BI"
            >
              <BarChart3 size={17} />
              Open Metabase
            </a>
            <div className="min-w-[220px] rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
              {busy ? "Loading data..." : error ? <span className="text-coral">{error}</span> : status || "Ready"}
            </div>
          </div>
        </div>
      </header>
      <div className="mx-auto max-w-[1800px] px-4 py-5 md:px-6">{children}</div>
    </main>
  );
}
