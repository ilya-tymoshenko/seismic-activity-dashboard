import { Activity, BarChart3, Database, RefreshCw } from "lucide-react";
import type { ReactNode } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { Progress, ProgressLabel } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import type { ImportJobStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

type Props = {
  children: ReactNode;
  busy?: boolean;
  status?: string;
  error?: string | null;
  actionJob?: ImportJobStatus | null;
  onSync: () => void;
  onImport: () => void;
};

export default function AppLayout({ children, busy, status, error, actionJob, onSync, onImport }: Props) {
  const metabaseUrl = process.env.NEXT_PUBLIC_METABASE_URL || "http://localhost:3001";
  const activeActionJob = actionJob && isActiveActionJob(actionJob) ? actionJob : null;

  return (
    <main className="min-h-screen bg-background">
      <header className="border-b bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/85">
        <div className="mx-auto flex max-w-[1800px] flex-col gap-4 px-4 py-4 md:px-6 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <div className="grid size-10 shrink-0 place-items-center rounded-lg bg-destructive text-destructive-foreground shadow-sm">
              <Activity size={22} />
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-xl font-semibold tracking-normal text-foreground md:text-2xl">Global Seismic Activity Analytics</h1>
              <p className="text-sm text-muted-foreground">USGS Earthquake Catalog + PostGIS + Metabase</p>
            </div>
          </div>

          <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
            <div className="flex items-center gap-2">
              <Button
                size="lg"
                disabled={busy}
                onClick={onSync}
                type="button"
                title="Sync recent USGS data"
              >
                <RefreshCw size={17} className={activeActionJob?.kind === "sync" ? "animate-spin" : ""} />
                Sync Data
              </Button>
              <Button
                size="lg"
                variant="secondary"
                disabled={busy}
                onClick={onImport}
                type="button"
                title="Import historical USGS data"
              >
                <Database size={17} className={activeActionJob?.kind === "history" ? "animate-pulse" : ""} />
                Import History
              </Button>
              <a
                className={cn(buttonVariants({ variant: "outline", size: "lg" }))}
                href={metabaseUrl}
                rel="noreferrer"
                target="_blank"
                title="Open Metabase BI"
              >
                <BarChart3 size={17} />
                Open Metabase
              </a>
            </div>
            {activeActionJob && <ActionProgress job={activeActionJob} />}
            <Separator className="hidden h-8 lg:block" orientation="vertical" />
            <Alert className={cn("min-w-[280px] max-w-xl py-2", error && "border-destructive/40")} variant={error ? "destructive" : "default"}>
              <AlertDescription className="line-clamp-2">
                {busy ? "Loading data..." : error || status || "Ready"}
              </AlertDescription>
            </Alert>
          </div>
        </div>
      </header>
      <div className="mx-auto max-w-[1800px] px-4 py-5 md:px-6">{children}</div>
    </main>
  );
}

function ActionProgress({ job }: { job: ImportJobStatus }) {
  const progress = Math.round(job.progress);
  const stepText = job.totalSteps > 0
    ? `${job.currentStep.toLocaleString()}/${job.totalSteps.toLocaleString()}`
    : "";

  return (
    <div className="min-w-[260px] max-w-sm space-y-1">
      <Progress value={progress}>
        <ProgressLabel className="text-xs">{job.label}</ProgressLabel>
        <span className="ml-auto text-xs text-muted-foreground tabular-nums">{progress}%</span>
      </Progress>
      <div className="flex min-w-0 items-center justify-between gap-3 text-xs text-muted-foreground">
        <span className="truncate">{job.message}</span>
        {stepText && <span className="shrink-0 tabular-nums">{stepText}</span>}
      </div>
    </div>
  );
}

function isActiveActionJob(job: ImportJobStatus) {
  return job.status === "queued" || job.status === "running";
}
