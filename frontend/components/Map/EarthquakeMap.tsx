import L from "leaflet";
import type { MutableRefObject } from "react";
import { useCallback, useEffect, useRef } from "react";
import { MapContainer, TileLayer, useMap, useMapEvents } from "react-leaflet";
import type { Bounds, Earthquake } from "../../lib/types";
import { formatDateTime, formatNumber, magnitudeTone } from "../../lib/format";
import { Card } from "@/components/ui/card";

type Props = {
  earthquakes: Earthquake[];
  onBoundsChange: (bounds: Bounds) => void;
};

type DrawnPoint = {
  earthquake: Earthquake;
  kind: "event";
  radius: number;
  x: number;
  y: number;
};

type DrawnCluster = {
  earthquakes: Earthquake[];
  kind: "cluster";
  latitude: number;
  longitude: number;
  maxMagnitude: number | null;
  radius: number;
  x: number;
  y: number;
};

type DrawnItem = DrawnCluster | DrawnPoint;

export default function EarthquakeMap({ earthquakes, onBoundsChange }: Props) {
  return (
    <Card className="relative h-[620px] overflow-hidden p-0 xl:h-[100%]">
      <MapLegend />
      <MapContainer
        center={[20, 0]}
        className="z-0"
        maxBounds={[[-90, -180], [90, 180]]}
        maxBoundsViscosity={0.8}
        preferCanvas
        scrollWheelZoom
        worldCopyJump
        zoom={2}
      >
        <TileLayer
          attribution="&copy; OpenStreetMap contributors"
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <BoundsReporter onBoundsChange={onBoundsChange} />
        <CanvasMarkerLayer earthquakes={earthquakes} />
      </MapContainer>
    </Card>
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

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className="size-2.5 rounded-full" style={{ backgroundColor: color }} />
      {label}
    </span>
  );
}

function CanvasMarkerLayer({ earthquakes }: { earthquakes: Earthquake[] }) {
  const map = useMap();
  const itemsRef = useRef<DrawnItem[]>([]);
  const earthquakesRef = useRef(earthquakes);
  const redrawRef = useRef<() => void>(() => undefined);
  const popupRef = useRef<L.Popup | null>(null);
  const popupEarthquakeIDRef = useRef<string | null>(null);

  useEffect(() => {
    earthquakesRef.current = earthquakes;
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
    const canvas = L.DomUtil.create("canvas", "leaflet-earthquake-canvas leaflet-layer") as HTMLCanvasElement;
    const pane = map.getPanes().overlayPane;
    pane.appendChild(canvas);

    const resizeCanvas = () => {
      const size = map.getSize();
      const pixelRatio = window.devicePixelRatio || 1;
      canvas.width = Math.round(size.x * pixelRatio);
      canvas.height = Math.round(size.y * pixelRatio);
      canvas.style.width = `${size.x}px`;
      canvas.style.height = `${size.y}px`;
      const topLeft = map.containerPointToLayerPoint([0, 0]);
      L.DomUtil.setPosition(canvas, topLeft);
    };

    const redraw = () => {
      const context = canvas.getContext("2d");
      if (!context) {
        return;
      }

      resizeCanvas();
      const size = map.getSize();
      const pixelRatio = window.devicePixelRatio || 1;
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      context.clearRect(0, 0, size.x, size.y);

      const visiblePoints: DrawnPoint[] = [];
      for (const earthquake of earthquakesRef.current) {
        const point = map.latLngToContainerPoint([earthquake.latitude, earthquake.longitude]);
        const radius = markerRadius(earthquake.magnitude);
        if (point.x < -radius || point.y < -radius || point.x > size.x + radius || point.y > size.y + radius) {
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

      const nextItems = clusterVisiblePoints(visiblePoints, map.getZoom(), resolveMaxZoom(map));
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

    redrawRef.current = redraw;
    redraw();

    map.on({
      click: handleClick,
      mousemove: handleMouseMove,
      mouseout: handleMouseOut,
      moveend: redraw,
      resize: redraw,
      viewreset: redraw,
      zoomend: redraw
    });

    return () => {
      map.off({
        click: handleClick,
        mousemove: handleMouseMove,
        mouseout: handleMouseOut,
        moveend: redraw,
        resize: redraw,
        viewreset: redraw,
        zoomend: redraw
      });
      popupRef.current?.remove();
      popupEarthquakeIDRef.current = null;
      map.getContainer().style.cursor = "";
      L.DomUtil.remove(canvas);
      itemsRef.current = [];
      redrawRef.current = () => undefined;
    };
  }, [map]);

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
  return Math.max(6, Math.min(20, 6 + (magnitude || 1.5) * 2));
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

function clusterVisiblePoints(points: DrawnPoint[], zoom: number, maxZoom: number): DrawnItem[] {
  const clusterRadius = clusterPixelRadius(zoom);
  const clusters: DrawnCluster[] = [];
  const isTerminalZoom = zoom >= maxZoom;

  for (const point of points) {
    let nearestCluster: DrawnCluster | null = null;
    let nearestDistance = Number.POSITIVE_INFINITY;
    for (const cluster of clusters) {
      const dx = cluster.x - point.x;
      const dy = cluster.y - point.y;
      const distance = dx * dx + dy * dy;
      if (distance <= clusterRadius * clusterRadius && distance < nearestDistance) {
        nearestCluster = cluster;
        nearestDistance = distance;
      }
    }

    if (nearestCluster) {
      addPointToCluster(nearestCluster, point);
    } else {
      clusters.push({
        earthquakes: [point.earthquake],
        kind: "cluster",
        latitude: point.earthquake.latitude,
        longitude: point.earthquake.longitude,
        maxMagnitude: point.earthquake.magnitude,
        radius: point.radius,
        x: point.x,
        y: point.y
      });
    }
  }

  return clusters.flatMap((cluster) => {
    if (cluster.earthquakes.length === 1) {
      const earthquake = cluster.earthquakes[0];
      return {
        earthquake,
        kind: "event",
        radius: markerRadius(earthquake.magnitude),
        x: cluster.x,
        y: cluster.y
      } satisfies DrawnPoint;
    }
    if (isTerminalZoom) {
      return expandTerminalCluster(cluster);
    }
    cluster.radius = clusterMarkerRadius(cluster.earthquakes.length);
    return cluster;
  });
}

function addPointToCluster(cluster: DrawnCluster, point: DrawnPoint) {
  const nextCount = cluster.earthquakes.length + 1;
  cluster.x = (cluster.x * cluster.earthquakes.length + point.x) / nextCount;
  cluster.y = (cluster.y * cluster.earthquakes.length + point.y) / nextCount;
  cluster.latitude = (cluster.latitude * cluster.earthquakes.length + point.earthquake.latitude) / nextCount;
  cluster.longitude = circularLongitudeMean([...cluster.earthquakes, point.earthquake]);
  cluster.maxMagnitude = maxMagnitude(cluster.maxMagnitude, point.earthquake.magnitude);
  cluster.earthquakes.push(point.earthquake);
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
    return 34;
  }
  if (count >= 100) {
    return 30;
  }
  if (count >= 10) {
    return 25;
  }
  return 21;
}

function expandTerminalCluster(cluster: DrawnCluster): DrawnPoint[] {
  return cluster.earthquakes.map((earthquake, index) => {
    const [offsetX, offsetY] = terminalClusterOffset(index);
    return {
      earthquake,
      kind: "event",
      radius: markerRadius(earthquake.magnitude),
      x: cluster.x + offsetX,
      y: cluster.y + offsetY
    };
  });
}

function terminalClusterOffset(index: number) {
  if (index === 0) {
    return [0, 0] as const;
  }

  let ring = 1;
  let firstIndexInRing = 1;
  let pointsInRing = 6;
  while (index >= firstIndexInRing + pointsInRing) {
    firstIndexInRing += pointsInRing;
    ring += 1;
    pointsInRing = ring * 6;
  }

  const positionInRing = index - firstIndexInRing;
  const angle = (Math.PI * 2 * positionInRing) / pointsInRing - Math.PI / 2;
  const distance = 24 + (ring - 1) * 18;
  return [Math.cos(angle) * distance, Math.sin(angle) * distance] as const;
}

function drawCluster(context: CanvasRenderingContext2D, cluster: DrawnCluster) {
  const count = cluster.earthquakes.length;
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
  const bounds = L.latLngBounds(cluster.earthquakes.map((earthquake) => [earthquake.latitude, earthquake.longitude] as L.LatLngTuple));
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

function circularLongitudeMean(earthquakes: Earthquake[]) {
  let sin = 0;
  let cos = 0;
  for (const earthquake of earthquakes) {
    const radians = earthquake.longitude * Math.PI / 180;
    sin += Math.sin(radians);
    cos += Math.cos(radians);
  }
  const longitude = Math.atan2(sin, cos) * 180 / Math.PI;
  if (longitude > 180) {
    return longitude - 360;
  }
  if (longitude < -180) {
    return longitude + 360;
  }
  return longitude;
}

function escapeHTML(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
