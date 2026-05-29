import L from "leaflet";
import type { MutableRefObject } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MapContainer, TileLayer, useMap, useMapEvents } from "react-leaflet";
import type { Bounds, Earthquake } from "../../lib/types";
import { formatDateTime, formatNumber, magnitudeTone } from "../../lib/format";
import { Card } from "@/components/ui/card";

type Props = {
  earthquakes: Earthquake[];
  mapBusy?: boolean;
  onBoundsChange: (bounds: Bounds) => void;
  renderLimit?: number;
};

type DrawnPoint = {
  earthquake: Earthquake;
  kind: "event";
  radius: number;
  x: number;
  y: number;
};

type DrawnCluster = {
  kind: "cluster";
  latitude: number;
  longitude: number;
  maxMagnitude: number | null;
  radius: number;
  x: number;
  y: number;
  count: number;
  bounds?: ClusterBounds;
  earthquake?: Earthquake;
};

type ClusterBounds = {
  minLon: number;
  minLat: number;
  maxLon: number;
  maxLat: number;
};

type DrawnItem = DrawnCluster | DrawnPoint;

type WorkerEventItem = {
  kind: "event";
  id: string;
  radius: number;
  x: number;
  y: number;
};

type WorkerClusterItem = {
  kind: "cluster";
  latitude: number;
  longitude: number;
  maxMagnitude: number | null;
  radius: number;
  x: number;
  y: number;
  count: number;
  bounds?: ClusterBounds;
};

type WorkerResponse = {
  requestId: number;
  items: Array<WorkerEventItem | WorkerClusterItem>;
};

export default function EarthquakeMap({ earthquakes, mapBusy = false, onBoundsChange, renderLimit }: Props) {
  const [clusterBusy, setClusterBusy] = useState(false);
  const loadingRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [showLoading, setShowLoading] = useState(false);

  useEffect(() => {
    const nextBusy = mapBusy || clusterBusy;
    if (!nextBusy) {
      if (loadingRef.current) {
        clearTimeout(loadingRef.current);
        loadingRef.current = null;
      }
      setShowLoading(false);
      return;
    }
    if (showLoading || loadingRef.current) {
      return;
    }
    loadingRef.current = setTimeout(() => {
      loadingRef.current = null;
      setShowLoading(true);
    }, 250);
    return () => {
      if (loadingRef.current) {
        clearTimeout(loadingRef.current);
        loadingRef.current = null;
      }
    };
  }, [clusterBusy, mapBusy, showLoading]);

  return (
    <Card className="relative h-[620px] overflow-hidden p-0 xl:h-[100%]">
      <MapLegend />
      {showLoading && <MapLoadingOverlay />}
      <MapContainer
        center={[20, 0]}
        className="z-0"
        maxBounds={[[-90, -180], [90, 180]]}
        maxBoundsViscosity={0.8}
        minZoom={2}
        preferCanvas
        scrollWheelZoom
        zoom={2}
      >
        <TileLayer
          attribution="&copy; OpenStreetMap contributors"
          noWrap
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <MapSearch earthquakes={earthquakes} />
        <BoundsReporter onBoundsChange={onBoundsChange} />
        <CanvasMarkerLayer
          earthquakes={earthquakes}
          renderLimit={renderLimit}
          onBusyChange={setClusterBusy}
        />
      </MapContainer>
    </Card>
  );
}

function MapLoadingOverlay() {
  return (
    <div className="pointer-events-none absolute inset-0 z-[400] flex items-center justify-center bg-slate-950/30">
      <div className="rounded-full border border-white/40 bg-slate-950/70 px-3 py-2 text-xs text-white shadow-sm">
        <span className="inline-flex items-center gap-2">
          <span className="inline-flex size-4 items-center justify-center">
            <span className="size-4 animate-spin rounded-full border-2 border-white/50 border-t-white" />
          </span>
          Loading map
        </span>
      </div>
    </div>
  );
}

function MapLegend() {
  return (
    <div className="pointer-events-none absolute bottom-3 left-3 z-[500] rounded-lg border bg-card/95 px-3 py-2 text-xs text-muted-foreground shadow-sm backdrop-blur">
      <div className="mb-1 font-medium text-foreground">Magnitude</div>
      <div className="flex flex-wrap items-center gap-2">
        <LegendDot color="#2ca58d" label="< 3" />
        <LegendDot color="#f3a712" label="3-4.9" />
        <LegendDot color="#e15b42" label="5-6.9" />
        <LegendDot color="#b91c1c" label="7+" />
      </div>
    </div>
  );
}

function MapSearch({ earthquakes }: { earthquakes: Earthquake[] }) {
  const map = useMap();
  const [query, setQuery] = useState("");

  const matches = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) {
      return [] as Earthquake[];
    }
    return earthquakes
      .filter((earthquake) => {
        const place = earthquake.place?.toLowerCase() || "";
        return place.includes(normalized) || earthquake.id.toLowerCase().includes(normalized);
      })
      .slice(0, 8);
  }, [earthquakes, query]);

  const handleSelect = (earthquake: Earthquake) => {
    const nextZoom = Math.max(map.getZoom(), 5);
    map.setView([earthquake.latitude, earthquake.longitude], nextZoom);
    L.popup({ maxWidth: 320 })
      .setLatLng([earthquake.latitude, earthquake.longitude])
      .setContent(renderEventPopup(earthquake))
      .openOn(map);
  };

  return (
    <div className="absolute right-3 top-3 z-[500] w-[260px] rounded-lg border bg-card/95 p-2 text-xs shadow-sm backdrop-blur">
      <label className="block text-[11px] font-medium text-muted-foreground">Search event</label>
      <input
        className="mt-1 w-full rounded-md border bg-background px-2 py-1 text-xs text-foreground"
        placeholder="Place or ID"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      {matches.length > 0 && (
        <div className="mt-2 max-h-44 space-y-1 overflow-auto">
          {matches.map((earthquake) => (
            <button
              key={earthquake.id}
              className="w-full rounded-md border border-transparent bg-muted/40 px-2 py-1 text-left text-xs text-foreground hover:border-primary/30 hover:bg-muted"
              type="button"
              onClick={() => handleSelect(earthquake)}
            >
              <div className="truncate font-medium">{earthquake.place || "Unknown location"}</div>
              <div className="text-[11px] text-muted-foreground">ID: {earthquake.id}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className="size-2.5 rounded-full" style={{ backgroundColor: color }} />
      {label}
    </span>
  );
}

function CanvasMarkerLayer({
  earthquakes,
  renderLimit,
  onBusyChange
}: {
  earthquakes: Earthquake[];
  renderLimit?: number;
  onBusyChange?: (busy: boolean) => void;
}) {
  const map = useMap();
  const CANVAS_PADDING = 64;
  const itemsRef = useRef<DrawnItem[]>([]);
  const earthquakesRef = useRef(earthquakes);
  const earthquakeByIdRef = useRef(new Map<string, Earthquake>());
  const redrawRef = useRef<() => void>(() => undefined);
  const popupRef = useRef<L.Popup | null>(null);
  const popupEarthquakeIDRef = useRef<string | null>(null);
  const isZoomingRef = useRef(false);
  const renderLimitRef = useRef(renderLimit);
  const workerRef = useRef<Worker | null>(null);
  const workerRequestIdRef = useRef(0);
  const redrawFrameRef = useRef<number | null>(null);
  const redrawQueuedRef = useRef(false);
  const busyRef = useRef(false);

  const setBusy = useCallback((nextBusy: boolean) => {
    if (busyRef.current === nextBusy) {
      return;
    }
    busyRef.current = nextBusy;
    onBusyChange?.(nextBusy);
  }, [onBusyChange]);

  useEffect(() => {
    earthquakesRef.current = earthquakes;
    const nextMap = new Map<string, Earthquake>();
    for (const earthquake of earthquakes) {
      nextMap.set(earthquake.id, earthquake);
    }
    earthquakeByIdRef.current = nextMap;
    if (popupEarthquakeIDRef.current) {
      const currentPopupEarthquake = earthquakes.find((earthquake) => earthquake.id === popupEarthquakeIDRef.current);
      if (currentPopupEarthquake) {
        popupRef.current
          ?.setLatLng([currentPopupEarthquake.latitude, currentPopupEarthquake.longitude])
          .setContent(renderEventPopup(currentPopupEarthquake));
      } else {
        popupRef.current?.remove();
        popupRef.current = null;
        popupEarthquakeIDRef.current = null;
      }
    }
    redrawRef.current();
  }, [earthquakes]);

  useEffect(() => {
    renderLimitRef.current = renderLimit;
    redrawRef.current();
  }, [renderLimit]);

  useEffect(() => {
    const canvas = L.DomUtil.create("canvas", "leaflet-earthquake-canvas leaflet-layer") as HTMLCanvasElement;
    const pane = map.getPanes().overlayPane;
    pane.appendChild(canvas);

    const resizeCanvas = () => {
      const size = map.getSize();
      const pixelRatio = window.devicePixelRatio || 1;
      const paddedWidth = size.x + CANVAS_PADDING * 2;
      const paddedHeight = size.y + CANVAS_PADDING * 2;
      canvas.width = Math.round(paddedWidth * pixelRatio);
      canvas.height = Math.round(paddedHeight * pixelRatio);
      canvas.style.width = `${paddedWidth}px`;
      canvas.style.height = `${paddedHeight}px`;
      const topLeft = map
        .containerPointToLayerPoint([0, 0])
        .subtract(L.point(CANVAS_PADDING, CANVAS_PADDING));
      L.DomUtil.setPosition(canvas, topLeft);
    };

    const clearCanvas = () => {
      const context = canvas.getContext("2d");
      if (!context) {
        return;
      }
      resizeCanvas();
      const size = map.getSize();
      const pixelRatio = window.devicePixelRatio || 1;
      context.setTransform(pixelRatio, 0, 0, pixelRatio, CANVAS_PADDING, CANVAS_PADDING);
      context.clearRect(
        -CANVAS_PADDING,
        -CANVAS_PADDING,
        size.x + CANVAS_PADDING * 2,
        size.y + CANVAS_PADDING * 2
      );
    };

    const drawItems = (nextItems: DrawnItem[]) => {
      if (isZoomingRef.current) {
        return;
      }
      setBusy(false);
      const context = canvas.getContext("2d");
      if (!context) {
        return;
      }

      resizeCanvas();
      const size = map.getSize();
      const pixelRatio = window.devicePixelRatio || 1;
      context.setTransform(pixelRatio, 0, 0, pixelRatio, CANVAS_PADDING, CANVAS_PADDING);
      context.clearRect(
        -CANVAS_PADDING,
        -CANVAS_PADDING,
        size.x + CANVAS_PADDING * 2,
        size.y + CANVAS_PADDING * 2
      );

      const singles = nextItems.filter((item) => item.kind === "event") as DrawnPoint[];
      const clusters = nextItems.filter((item) => item.kind === "cluster") as DrawnCluster[];

      for (const item of singles) {
        drawMarker(context, item.x, item.y, item.radius, magnitudeTone(item.earthquake.magnitude));
      }
      for (const item of clusters) {
        drawCluster(context, item);
      }

      itemsRef.current = nextItems;
      closePopupIfHidden(nextItems, popupRef, popupEarthquakeIDRef);
    };

    const redraw = () => {
      if (isZoomingRef.current) {
        return;
      }
      setBusy(true);

      const size = map.getSize();
      const visiblePoints: DrawnPoint[] = [];
      for (const earthquake of earthquakesRef.current) {
        const point = map.latLngToContainerPoint([earthquake.latitude, earthquake.longitude]);
        const radius = markerRadius(earthquake.magnitude);
        const padding = CANVAS_PADDING + radius;
        if (point.x < -padding || point.y < -padding || point.x > size.x + padding || point.y > size.y + padding) {
          continue;
        }
        visiblePoints.push({
          earthquake,
          kind: "event",
          radius,
          x: point.x,
          y: point.y
        });
      }

      const worker = workerRef.current;
      if (worker) {
        workerRequestIdRef.current += 1;
        const requestId = workerRequestIdRef.current;
        worker.postMessage({
          requestId,
          zoom: map.getZoom(),
          renderLimit: renderLimitRef.current,
          points: visiblePoints.map((point) => ({
            id: point.earthquake.id,
            latitude: point.earthquake.latitude,
            longitude: point.earthquake.longitude,
            magnitude: point.earthquake.magnitude,
            x: point.x,
            y: point.y,
            radius: point.radius
          }))
        });
        return;
      }

      const nextItems = clusterVisiblePoints(
        visiblePoints,
        map.getZoom(),
        renderLimitRef.current
      );
      drawItems(nextItems);
    };

    const findHit = (point: L.Point) => {
      let selected: DrawnItem | null = null;
      let selectedDistance = Number.POSITIVE_INFINITY;
      for (const candidate of itemsRef.current) {
        const dx = candidate.x - point.x;
        const dy = candidate.y - point.y;
        const distance = dx * dx + dy * dy;
        const hitRadius = candidate.radius + (candidate.kind === "cluster" ? 4 : 5);
        if (distance <= hitRadius * hitRadius && distance < selectedDistance) {
          selected = candidate;
          selectedDistance = distance;
        }
      }
      return selected;
    };

    const handleClick = (event: L.LeafletMouseEvent) => {
      const hit = findHit(event.containerPoint);
      if (!hit) {
        return;
      }
      popupRef.current?.remove();
      if (hit.kind === "cluster") {
        zoomToCluster(map, hit);
        return;
      }

      const popup = L.popup({ maxWidth: 320 })
        .setLatLng([hit.earthquake.latitude, hit.earthquake.longitude])
        .setContent(renderEventPopup(hit.earthquake));
      popupRef.current = popup;
      popupEarthquakeIDRef.current = hit.earthquake.id;
      popup.on("remove", () => {
        if (popupRef.current === popup) {
          popupRef.current = null;
          popupEarthquakeIDRef.current = null;
        }
      });
      popup.openOn(map);
    };

    const handleMouseMove = (event: L.LeafletMouseEvent) => {
      const hit = findHit(event.containerPoint);
      map.getContainer().style.cursor = hit ? "pointer" : "";
    };

    const handleMouseOut = () => {
      map.getContainer().style.cursor = "";
    };

    const handleZoomStart = () => {
      isZoomingRef.current = true;
      itemsRef.current = [];
      clearCanvas();
      closePopupIfHidden([], popupRef, popupEarthquakeIDRef);
      setBusy(true);
    };

    const handleZoomEnd = () => {
      isZoomingRef.current = false;
      scheduleRedraw();
    };

    const scheduleRedraw = () => {
      if (redrawQueuedRef.current) {
        return;
      }
      redrawQueuedRef.current = true;
      redrawFrameRef.current = window.requestAnimationFrame(() => {
        redrawQueuedRef.current = false;
        redraw();
      });
    };

    redrawRef.current = scheduleRedraw;
    scheduleRedraw();

    const worker = new Worker(new URL("../../workers/earthquakeCluster.worker.ts", import.meta.url));
    workerRef.current = worker;
    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      if (event.data.requestId !== workerRequestIdRef.current) {
        return;
      }
      if (isZoomingRef.current) {
        return;
      }
      const quakeMap = earthquakeByIdRef.current;
      const nextItems = event.data.items.flatMap((item) => {
        if (item.kind === "event") {
          const earthquake = quakeMap.get(item.id);
          if (!earthquake) {
            return [];
          }
          return {
            earthquake,
            kind: "event",
            radius: item.radius,
            x: item.x,
            y: item.y
          } satisfies DrawnPoint;
        }
        return {
          kind: "cluster",
          latitude: item.latitude,
          longitude: item.longitude,
          maxMagnitude: item.maxMagnitude,
          radius: item.radius,
          x: item.x,
          y: item.y,
          count: item.count,
          bounds: item.bounds
        } satisfies DrawnCluster;
      });
      drawItems(nextItems);
    };

    map.on({
      click: handleClick,
      mousemove: handleMouseMove,
      mouseout: handleMouseOut,
      moveend: scheduleRedraw,
      resize: scheduleRedraw,
      viewreset: scheduleRedraw,
      zoomstart: handleZoomStart,
      zoomend: handleZoomEnd
    });

    return () => {
      map.off({
        click: handleClick,
        mousemove: handleMouseMove,
        mouseout: handleMouseOut,
        moveend: scheduleRedraw,
        resize: scheduleRedraw,
        viewreset: scheduleRedraw,
        zoomstart: handleZoomStart,
        zoomend: handleZoomEnd
      });
      if (redrawFrameRef.current !== null) {
        window.cancelAnimationFrame(redrawFrameRef.current);
      }
      redrawQueuedRef.current = false;
      popupRef.current?.remove();
      popupEarthquakeIDRef.current = null;
      map.getContainer().style.cursor = "";
      setBusy(false);
      worker.terminate();
      workerRef.current = null;
      L.DomUtil.remove(canvas);
      itemsRef.current = [];
      redrawRef.current = () => undefined;
    };
  }, [map, setBusy]);

  return null;
}

function BoundsReporter({ onBoundsChange }: { onBoundsChange: (bounds: Bounds) => void }) {
  const map = useMap();
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const emit = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    timeoutRef.current = setTimeout(() => {
      const bounds = map.getBounds();
      onBoundsChange({
        minLon: Number(clamp(bounds.getWest(), -180, 180).toFixed(5)),
        minLat: Number(clamp(bounds.getSouth(), -90, 90).toFixed(5)),
        maxLon: Number(clamp(bounds.getEast(), -180, 180).toFixed(5)),
        maxLat: Number(clamp(bounds.getNorth(), -90, 90).toFixed(5))
      });
    }, 550);
  }, [map, onBoundsChange]);

  useMapEvents({
    moveend: emit,
    zoomend: emit
  });

  useEffect(() => {
    emit();
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [emit]);

  return null;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function renderEventPopup(earthquake: Earthquake) {
  return `
    <div class="min-w-[220px] space-y-1 text-sm">
      <div class="font-bold text-foreground">${escapeHTML(earthquake.place || "Unknown location")}</div>
      <div><strong>Time:</strong> ${escapeHTML(formatDateTime(earthquake.time))}</div>
      <div><strong>Magnitude:</strong> ${escapeHTML(formatNumber(earthquake.magnitude, 1))}</div>
      <div><strong>Depth:</strong> ${escapeHTML(formatNumber(earthquake.depth, 1))} km</div>
      <div><strong>Tsunami:</strong> ${earthquake.tsunami === 1 ? "Yes" : "No"}</div>
      <div><strong>Alert:</strong> ${escapeHTML(earthquake.alert || "n/a")}</div>
      <div class="break-all text-xs text-slate-500"><strong>ID:</strong> ${escapeHTML(earthquake.id)}</div>
    </div>
  `;
}

function markerRadius(magnitude: number | null) {
  return Math.max(4, Math.min(14, 4 + (magnitude || 1.5) * 1.5));
}

function drawMarker(context: CanvasRenderingContext2D, x: number, y: number, radius: number, color: string) {
  context.beginPath();
  context.arc(x, y, radius, 0, Math.PI * 2);
  context.fillStyle = color;
  context.fill();
  context.lineWidth = 2;
  context.strokeStyle = "#ffffff";
  context.stroke();

  context.beginPath();
  context.arc(x, y, Math.max(1.75, radius * 0.28), 0, Math.PI * 2);
  context.fillStyle = "rgba(255, 255, 255, 0.86)";
  context.fill();
}

function clusterVisiblePoints(points: DrawnPoint[], zoom: number, renderLimit?: number): DrawnItem[] {
  if (points.length === 0) {
    return [];
  }

  const limit = normalizeRenderLimit(renderLimit);
  const baseRadius = clusterPixelRadius(zoom);
  let clusters = clusterPoints(points, baseRadius);
  let items = materializeClusters(clusters);
  if (items.length <= limit) {
    return items;
  }

  return limitClusterItems(points, baseRadius, limit);
}

function normalizeRenderLimit(renderLimit?: number) {
  if (!renderLimit || !Number.isFinite(renderLimit) || renderLimit <= 0) {
    return Number.POSITIVE_INFINITY;
  }
  return Math.floor(renderLimit);
}

function limitClusterItems(points: DrawnPoint[], baseRadius: number, limit: number): DrawnItem[] {
  const maxRadius = 240;
  let radius = baseRadius;
  let clusters = clusterPoints(points, radius);
  let items = materializeClusters(clusters);
  if (items.length <= limit) {
    return items;
  }

  for (let step = 0; step < 10 && radius < maxRadius; step += 1) {
    const nextRadius = Math.min(maxRadius, Math.ceil(radius * 1.35) + 2);
    if (nextRadius === radius) {
      break;
    }
    radius = nextRadius;
    clusters = clusterPoints(points, radius);
    items = materializeClusters(clusters);
    if (items.length <= limit) {
      return items;
    }
  }

  if (radius < maxRadius) {
    clusters = clusterPoints(points, maxRadius);
    items = materializeClusters(clusters);
  }
  return items;
}

function clusterPoints(points: DrawnPoint[], clusterRadius: number): DrawnCluster[] {
  const clusters: DrawnCluster[] = [];
  const cellSize = Math.max(12, clusterRadius);
  const grid = new Map<string, number[]>();
  const radiusSquared = clusterRadius * clusterRadius;

  const registerCluster = (clusterIndex: number) => {
    const cluster = clusters[clusterIndex];
    const cellX = Math.floor(cluster.x / cellSize);
    const cellY = Math.floor(cluster.y / cellSize);
    const key = `${cellX},${cellY}`;
    const bucket = grid.get(key);
    if (bucket) {
      bucket.push(clusterIndex);
    } else {
      grid.set(key, [clusterIndex]);
    }
  };

  for (const point of points) {
    const cellX = Math.floor(point.x / cellSize);
    const cellY = Math.floor(point.y / cellSize);
    let nearestCluster: DrawnCluster | null = null;
    let nearestDistance = Number.POSITIVE_INFINITY;

    for (let dxCell = -1; dxCell <= 1; dxCell += 1) {
      for (let dyCell = -1; dyCell <= 1; dyCell += 1) {
        const key = `${cellX + dxCell},${cellY + dyCell}`;
        const bucket = grid.get(key);
        if (!bucket) {
          continue;
        }
        for (const clusterIndex of bucket) {
          const cluster = clusters[clusterIndex];
          const dx = cluster.x - point.x;
          const dy = cluster.y - point.y;
          const distance = dx * dx + dy * dy;
          if (distance <= radiusSquared && distance < nearestDistance) {
            nearestCluster = cluster;
            nearestDistance = distance;
          }
        }
      }
    }

    if (nearestCluster) {
      addPointToCluster(nearestCluster, point);
      continue;
    }

    clusters.push({
      kind: "cluster",
      latitude: point.earthquake.latitude,
      longitude: point.earthquake.longitude,
      maxMagnitude: point.earthquake.magnitude,
      radius: point.radius,
      x: point.x,
      y: point.y,
      count: 1,
      bounds: {
        minLon: point.earthquake.longitude,
        minLat: point.earthquake.latitude,
        maxLon: point.earthquake.longitude,
        maxLat: point.earthquake.latitude
      },
      earthquake: point.earthquake
    });
    registerCluster(clusters.length - 1);
  }

  return clusters;
}

function materializeClusters(clusters: DrawnCluster[]): DrawnItem[] {
  return clusters.flatMap((cluster) => {
    if (cluster.count === 1 && cluster.earthquake) {
      const earthquake = cluster.earthquake;
      return {
        earthquake,
        kind: "event",
        radius: markerRadius(earthquake.magnitude),
        x: cluster.x,
        y: cluster.y
      } satisfies DrawnPoint;
    }
    cluster.radius = clusterMarkerRadius(cluster.count);
    return cluster;
  });
}

function addPointToCluster(cluster: DrawnCluster, point: DrawnPoint) {
  const nextCount = cluster.count + 1;
  cluster.x = (cluster.x * cluster.count + point.x) / nextCount;
  cluster.y = (cluster.y * cluster.count + point.y) / nextCount;
  cluster.latitude = (cluster.latitude * cluster.count + point.earthquake.latitude) / nextCount;
  cluster.longitude = (cluster.longitude * cluster.count + point.earthquake.longitude) / nextCount;
  cluster.maxMagnitude = maxMagnitude(cluster.maxMagnitude, point.earthquake.magnitude);
  cluster.count = nextCount;
  cluster.earthquake = undefined;
  if (!cluster.bounds) {
    cluster.bounds = {
      minLon: point.earthquake.longitude,
      minLat: point.earthquake.latitude,
      maxLon: point.earthquake.longitude,
      maxLat: point.earthquake.latitude
    };
  } else {
    cluster.bounds.minLon = Math.min(cluster.bounds.minLon, point.earthquake.longitude);
    cluster.bounds.maxLon = Math.max(cluster.bounds.maxLon, point.earthquake.longitude);
    cluster.bounds.minLat = Math.min(cluster.bounds.minLat, point.earthquake.latitude);
    cluster.bounds.maxLat = Math.max(cluster.bounds.maxLat, point.earthquake.latitude);
  }
}

function clusterPixelRadius(zoom: number) {
  if (zoom >= 8) {
    return 30;
  }
  if (zoom >= 5) {
    return 38;
  }
  return 48;
}

function clusterMarkerRadius(count: number) {
  if (count >= 1000) {
    return 28;
  }
  if (count >= 100) {
    return 24;
  }
  if (count >= 10) {
    return 20;
  }
  return 17;
}


function drawCluster(context: CanvasRenderingContext2D, cluster: DrawnCluster) {
  const count = cluster.count;
  const color = magnitudeTone(cluster.maxMagnitude);
  context.beginPath();
  context.arc(cluster.x, cluster.y, cluster.radius, 0, Math.PI * 2);
  context.fillStyle = color;
  context.fill();
  context.lineWidth = 4;
  context.strokeStyle = "rgba(255, 255, 255, 0.92)";
  context.stroke();

  context.beginPath();
  context.arc(cluster.x, cluster.y, cluster.radius + 4, 0, Math.PI * 2);
  context.lineWidth = 2;
  context.strokeStyle = "rgba(15, 23, 42, 0.28)";
  context.stroke();

  context.font = `700 ${clusterFontSize(count)}px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
  context.fillStyle = "#ffffff";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(formatClusterCount(count), cluster.x, cluster.y);
}

function clusterFontSize(count: number) {
  if (count >= 1000) {
    return 12;
  }
  if (count >= 100) {
    return 13;
  }
  return 14;
}

function formatClusterCount(count: number) {
  if (count >= 1000) {
    return `${Math.floor(count / 100) / 10}k`;
  }
  return count.toString();
}

function zoomToCluster(map: L.Map, cluster: DrawnCluster) {
  const bounds = cluster.bounds
    ? L.latLngBounds(
      [cluster.bounds.minLat, cluster.bounds.minLon] as L.LatLngTuple,
      [cluster.bounds.maxLat, cluster.bounds.maxLon] as L.LatLngTuple
    )
    : L.latLngBounds([
      [cluster.latitude, cluster.longitude] as L.LatLngTuple,
      [cluster.latitude, cluster.longitude] as L.LatLngTuple
    ]);
  const nextZoom = Math.min(resolveMaxZoom(map), map.getZoom() + 3);
  if (bounds.isValid() && !bounds.getNorthEast().equals(bounds.getSouthWest())) {
    map.fitBounds(bounds.pad(0.25), { maxZoom: nextZoom });
    return;
  }
  map.setView([cluster.latitude, cluster.longitude], nextZoom);
}

function resolveMaxZoom(map: L.Map) {
  const maxZoom = map.getMaxZoom();
  if (Number.isFinite(maxZoom)) {
    return maxZoom;
  }
  return 18;
}

function closePopupIfHidden(items: DrawnItem[], popupRef: MutableRefObject<L.Popup | null>, popupEarthquakeIDRef: MutableRefObject<string | null>) {
  const popupEarthquakeID = popupEarthquakeIDRef.current;
  if (!popupEarthquakeID) {
    return;
  }
  const visibleAsSingle = items.some((item) => item.kind === "event" && item.earthquake.id === popupEarthquakeID);
  if (!visibleAsSingle) {
    popupRef.current?.remove();
    popupRef.current = null;
    popupEarthquakeIDRef.current = null;
  }
}

function maxMagnitude(current: number | null, next: number | null) {
  if (current === null) {
    return next;
  }
  if (next === null) {
    return current;
  }
  return Math.max(current, next);
}

function escapeHTML(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
