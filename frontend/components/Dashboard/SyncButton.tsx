import { Database, RefreshCw } from "lucide-react";

type Props = {
  busy: boolean;
  onSync: () => void;
  onImport: () => void;
};

export default function SyncButton({ busy, onSync, onImport }: Props) {
  return (
    <div className="flex gap-2">
      <button className="inline-flex items-center gap-2 rounded-lg bg-ocean px-3 py-2 text-sm font-semibold text-white" disabled={busy} onClick={onSync} type="button">
        <RefreshCw size={16} className={busy ? "animate-spin" : ""} />
        Sync
      </button>
      <button className="inline-flex items-center gap-2 rounded-lg bg-ink px-3 py-2 text-sm font-semibold text-white" disabled={busy} onClick={onImport} type="button">
        <Database size={16} />
        Import
      </button>
    </div>
  );
}
