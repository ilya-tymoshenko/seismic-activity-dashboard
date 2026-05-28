import L from "leaflet";
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
  radius: number;
  x: number;
  y: number;
};

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
  const pointsRef = useRef<DrawnPoint[]>([]);
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

      const nextPoints: DrawnPoint[] = [];
      for (const earthquake of earthquakesRef.current) {
        const point = map.latLngToContainerPoint([earthquake.latitude, earthquake.longitude]);
        const radius = markerRadius(earthquake.magnitude);
        if (point.x < -radius || point.y < -radius || point.x > size.x + radius || point.y > size.y + radius) {
          continue;
        }
        drawMarker(context, point.x, point.y, radius, magnitudeTone(earthquake.magnitude));
        nextPoints.push({
          earthquake,
          radius,
          x: point.x,
          y: point.y
        });
      }
      pointsRef.current = nextPoints;
    };

    const findHit = (point: L.Point) => {
      let selected: DrawnPoint | null = null;
      let selectedDistance = Number.POSITIVE_INFINITY;
      for (const candidate of pointsRef.current) {
        const dx = candidate.x - point.x;
        const dy = candidate.y - point.y;
        const distance = dx * dx + dy * dy;
        const hitRadius = candidate.radius + 5;
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
      pointsRef.current = [];
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

function escapeHTML(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
