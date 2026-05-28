import L from "leaflet";
import { useCallback, useEffect, useRef } from "react";
import { MapContainer, TileLayer, useMap, useMapEvents } from "react-leaflet";
import "leaflet.markercluster";
import type { Bounds, Earthquake } from "../../lib/types";
import { formatDateTime, formatNumber, magnitudeTone } from "../../lib/format";
import { Card } from "@/components/ui/card";

type Props = {
  earthquakes: Earthquake[];
  onBoundsChange: (bounds: Bounds) => void;
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
        <MarkerClusterLayer earthquakes={earthquakes} />
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

function MarkerClusterLayer({ earthquakes }: { earthquakes: Earthquake[] }) {
  const map = useMap();

  useEffect(() => {
    const leafletWithCluster = L as typeof L & {
      markerClusterGroup: (options?: Record<string, unknown>) => L.LayerGroup;
    };
    const group = leafletWithCluster.markerClusterGroup({
      chunkedLoading: true,
      maxClusterRadius: 48,
      spiderfyOnMaxZoom: true
    });

    earthquakes.forEach((earthquake) => {
      const marker = L.marker([earthquake.latitude, earthquake.longitude], {
        icon: makeIcon(earthquake.magnitude)
      });
      marker.bindPopup(renderEventPopup(earthquake));
      group.addLayer(marker);
    });

    map.addLayer(group);
    return () => {
      map.removeLayer(group);
    };
  }, [earthquakes, map]);

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

function makeIcon(magnitude: number | null) {
  const size = Math.max(12, Math.min(40, 12 + (magnitude || 1.5) * 4));
  const color = magnitudeTone(magnitude);
  return L.divIcon({
    className: "",
    html: `<span class="eq-marker" style="width:${size}px;height:${size}px;background:${color};"></span>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    popupAnchor: [0, -size / 2]
  });
}

function escapeHTML(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
