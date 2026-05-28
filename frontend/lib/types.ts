export type Bounds = {
  minLon: number;
  minLat: number;
  maxLon: number;
  maxLat: number;
};

export type Filters = {
  dateFrom?: string;
  dateTo?: string;
  minMagnitude?: string;
  maxMagnitude?: string;
  minDepth?: string;
  maxDepth?: string;
  tsunamiOnly?: boolean;
  alert?: string;
  type?: string;
  limit?: string;
};

export type Earthquake = {
  id: string;
  time: string;
  updated: string;
  latitude: number;
  longitude: number;
  depth: number | null;
  magnitude: number | null;
  magType: string | null;
  place: string;
  alert: string | null;
  tsunami: number;
  sig: number;
  type: string;
};

export type EarthquakesResponse = {
  data: Earthquake[];
  meta: {
    limit: number;
    returned: number;
  };
};

export type StatsResponse = {
  totalEvents: number;
  maxMagnitude: number | null;
  avgMagnitude: number | null;
  avgDepth: number | null;
  tsunamiEvents: number;
  eventsLast24h: number;
  eventsLast7d: number;
  strongestEvent: {
    id: string;
    time: string;
    magnitude: number | null;
    place: string;
  } | null;
};

export type DailyActivity = {
  date: string;
  count: number;
  avgMagnitude: number | null;
};

export type CategoryCount = {
  category: string;
  count: number;
};

export type TopPlace = {
  place: string;
  count: number;
  maxMagnitude: number | null;
};

export type AnalyticsResponse = {
  eventsByDay: DailyActivity[];
  magnitudeDistribution: CategoryCount[];
  depthDistribution: CategoryCount[];
  topPlaces: TopPlace[];
};

export type ImportSummary = {
  source?: string;
  feed?: string;
  days?: number;
  minMagnitude?: number;
  chunks?: number;
  fetched: number;
  processed: number;
  skipped: number;
  errors: number;
};

export type ImportJobStatus = {
  id: string;
  kind: "sync" | "history";
  label: string;
  status: "queued" | "running" | "succeeded" | "failed";
  message: string;
  params: {
    feed?: string;
    days?: number;
    minMagnitude?: number;
    chunkDays?: number;
  };
  progress: number;
  currentStep: number;
  totalSteps: number;
  summary: ImportSummary;
  error?: string;
  startedAt: string;
  finishedAt?: string;
};

export type ImportJobStartResponse = {
  jobId: string;
  status: ImportJobStatus;
};
