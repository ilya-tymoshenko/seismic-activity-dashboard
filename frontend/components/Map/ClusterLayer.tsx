import { Circle, Popup } from "react-leaflet";
import { formatNumber } from "../../lib/format";
import type { Cluster } from "../../lib/types";

type Props = {
  clusters: Cluster[];
};

export default function ClusterLayer({ clusters }: Props) {
  return (
    <>
      {clusters.map((cluster) => (
        <Circle
          key={cluster.clusterId}
          center={[cluster.latitude, cluster.longitude]}
          pathOptions={{ color: "#e15b42", fillColor: "#f3a712", fillOpacity: 0.22, weight: 2 }}
          radius={Math.min(900000, 45000 + cluster.eventCount * 12000)}
        >
          <Popup>
            <div className="min-w-[200px] space-y-1 text-sm">
              <div className="font-bold text-ink">Cluster #{cluster.clusterId}</div>
              <div><strong>Events:</strong> {cluster.eventCount}</div>
              <div><strong>Avg magnitude:</strong> {formatNumber(cluster.avgMagnitude, 2)}</div>
              <div><strong>Max magnitude:</strong> {formatNumber(cluster.maxMagnitude, 2)}</div>
              <div><strong>Avg depth:</strong> {formatNumber(cluster.avgDepth, 1)} km</div>
            </div>
          </Popup>
        </Circle>
      ))}
    </>
  );
}
