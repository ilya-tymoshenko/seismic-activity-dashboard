/// <reference lib="webworker" />

type ClusterBounds = {
  minLon: number;
  minLat: number;
  maxLon: number;
  maxLat: number;
};

type InputPoint = {
  id: string;
  latitude: number;
  longitude: number;
  magnitude: number | null;
  x: number;
  y: number;
  radius: number;
};

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

type WorkerRequest = {
  requestId: number;
  points: InputPoint[];
  zoom: number;
  renderLimit?: number;
};

type Cluster = {
  x: number;
  y: number;
  latitude: number;
  longitude: number;
  maxMagnitude: number | null;
  radius: number;
  count: number;
  bounds: ClusterBounds;
  sinSum: number;
  cosSum: number;
  single?: InputPoint;
};

const ctx = self as DedicatedWorkerGlobalScope;

ctx.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const { requestId, points, zoom, renderLimit } = event.data;
  const items = clusterVisiblePoints(points, zoom, renderLimit);
  const response: WorkerResponse = { requestId, items };
  ctx.postMessage(response);
};

function clusterVisiblePoints(
  points: InputPoint[],
  zoom: number,
  renderLimit?: number,
) {
  if (points.length === 0) {
    return [] as WorkerResponse["items"];
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

function limitClusterItems(
  points: InputPoint[],
  baseRadius: number,
  limit: number,
) {
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

function clusterPoints(points: InputPoint[], clusterRadius: number): Cluster[] {
  const clusters: Cluster[] = [];
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
    let nearestCluster: Cluster | null = null;
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

    const radians = (point.longitude * Math.PI) / 180;
    clusters.push({
      x: point.x,
      y: point.y,
      latitude: point.latitude,
      longitude: point.longitude,
      maxMagnitude: point.magnitude,
      radius: point.radius,
      count: 1,
      bounds: {
        minLon: point.longitude,
        minLat: point.latitude,
        maxLon: point.longitude,
        maxLat: point.latitude,
      },
      sinSum: Math.sin(radians),
      cosSum: Math.cos(radians),
      single: point,
    });
    registerCluster(clusters.length - 1);
  }

  return clusters;
}

function addPointToCluster(cluster: Cluster, point: InputPoint) {
  const nextCount = cluster.count + 1;
  cluster.x = (cluster.x * cluster.count + point.x) / nextCount;
  cluster.y = (cluster.y * cluster.count + point.y) / nextCount;
  cluster.latitude =
    (cluster.latitude * cluster.count + point.latitude) / nextCount;
  const radians = (point.longitude * Math.PI) / 180;
  cluster.sinSum += Math.sin(radians);
  cluster.cosSum += Math.cos(radians);
  cluster.longitude = circularLongitude(cluster.sinSum, cluster.cosSum);
  cluster.maxMagnitude = maxMagnitude(cluster.maxMagnitude, point.magnitude);
  if (cluster.count === 1) {
    cluster.single = undefined;
  }
  cluster.count = nextCount;
  cluster.bounds.minLon = Math.min(cluster.bounds.minLon, point.longitude);
  cluster.bounds.maxLon = Math.max(cluster.bounds.maxLon, point.longitude);
  cluster.bounds.minLat = Math.min(cluster.bounds.minLat, point.latitude);
  cluster.bounds.maxLat = Math.max(cluster.bounds.maxLat, point.latitude);
}

function materializeClusters(
  clusters: Cluster[],
): Array<WorkerEventItem | WorkerClusterItem> {
  return clusters.flatMap(
    (cluster): Array<WorkerEventItem | WorkerClusterItem> => {
      if (cluster.count === 1 && cluster.single) {
        const point = cluster.single;
        return [
          {
            kind: "event",
            id: point.id,
            radius: point.radius,
            x: point.x,
            y: point.y,
          } satisfies WorkerEventItem,
        ];
      }
      return [
        {
          kind: "cluster",
          latitude: cluster.latitude,
          longitude: cluster.longitude,
          maxMagnitude: cluster.maxMagnitude,
          radius: clusterMarkerRadius(cluster.count),
          x: cluster.x,
          y: cluster.y,
          count: cluster.count,
          bounds: cluster.bounds,
        } satisfies WorkerClusterItem,
      ];
    },
  );
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

function maxMagnitude(current: number | null, next: number | null) {
  if (current === null) {
    return next;
  }
  if (next === null) {
    return current;
  }
  return Math.max(current, next);
}

function circularLongitude(sinSum: number, cosSum: number) {
  const longitude = (Math.atan2(sinSum, cosSum) * 180) / Math.PI;
  if (longitude > 180) {
    return longitude - 360;
  }
  if (longitude < -180) {
    return longitude + 360;
  }
  return longitude;
}
