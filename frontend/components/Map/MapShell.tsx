import dynamic from "next/dynamic";
import type { Bounds, Cluster, Earthquake } from "../../lib/types";

const EarthquakeMap = dynamic(() => import("./EarthquakeMap"), {
  ssr: false,
  loading: () => <div className="grid h-full min-h-[560px] place-items-center bg-slate-100 text-sm text-slate-500">Loading map...</div>
});

type Props = {
  earthquakes: Earthquake[];
  clusters: Cluster[];
  showClusters: boolean;
  onBoundsChange: (bounds: Bounds) => void;
};

export default function MapShell(props: Props) {
  return <EarthquakeMap {...props} />;
}
