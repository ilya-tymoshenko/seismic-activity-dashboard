package repository

import (
	"math"
	"testing"

	"earthquake-big-data/backend/internal/models"
)

func TestAggregateClustersUsesCircularLongitudeMean(t *testing.T) {
	clusters := aggregateClusters(
		[]clusterEvent{
			{latitude: 10, longitude: 179.5},
			{latitude: 10, longitude: -179.5},
		},
		[]int{0, 0},
	)

	if len(clusters) != 1 {
		t.Fatalf("expected 1 cluster, got %d", len(clusters))
	}
	if math.Abs(math.Abs(clusters[0].Longitude)-180) > 0.01 {
		t.Fatalf("expected longitude near antimeridian, got %f", clusters[0].Longitude)
	}
}

func TestRegionQueryExpandsLongitudeScanAtHighLatitude(t *testing.T) {
	options := models.ClusterOptions{
		Eps:            1,
		MinPoints:      2,
		SpatialEpsKm:   300,
		DepthScaleKm:   100,
		MagnitudeScale: 1,
	}
	events := []clusterEvent{
		{latitude: 85, longitude: 0},
		{latitude: 85, longitude: 10},
	}
	cellDegrees := options.SpatialEpsKm * options.Eps / 111.0
	neighbors := regionQuery(events, buildClusterGrid(events, cellDegrees), 0, options, cellDegrees)

	if !containsClusterIndex(neighbors, 1) {
		t.Fatalf("expected high-latitude neighbor to be scanned, got %v", neighbors)
	}
}

func TestRegionQueryWrapsExactAntimeridianCell(t *testing.T) {
	options := models.ClusterOptions{
		Eps:            1,
		MinPoints:      2,
		SpatialEpsKm:   300,
		DepthScaleKm:   100,
		MagnitudeScale: 1,
	}
	events := []clusterEvent{
		{latitude: 0, longitude: -179.5},
		{latitude: 0, longitude: 180},
	}
	cellDegrees := options.SpatialEpsKm * options.Eps / 111.0
	neighbors := regionQuery(events, buildClusterGrid(events, cellDegrees), 0, options, cellDegrees)

	if !containsClusterIndex(neighbors, 1) {
		t.Fatalf("expected exact antimeridian neighbor to be scanned, got %v", neighbors)
	}
}

func TestNormalizeClusterOptionsCapsResourceSensitiveValues(t *testing.T) {
	options := normalizeClusterOptions(models.ClusterOptions{
		Mode:           "hybrid",
		Eps:            1_000_000_000,
		MinPoints:      1_000_000_000,
		SpatialEpsKm:   1_000_000_000,
		DepthScaleKm:   math.Inf(1),
		MagnitudeScale: math.NaN(),
	})

	if options.Eps != models.MaxClusterEps {
		t.Fatalf("expected eps cap %f, got %f", models.MaxClusterEps, options.Eps)
	}
	if options.MinPoints != models.MaxClusterMinPoints {
		t.Fatalf("expected minPoints cap %d, got %d", models.MaxClusterMinPoints, options.MinPoints)
	}
	if options.SpatialEpsKm != models.MaxClusterSpatialEpsKm {
		t.Fatalf("expected spatialEpsKm cap %f, got %f", models.MaxClusterSpatialEpsKm, options.SpatialEpsKm)
	}
	if options.DepthScaleKm != 100 {
		t.Fatalf("expected non-finite depthScaleKm fallback, got %f", options.DepthScaleKm)
	}
	if options.MagnitudeScale != 1 {
		t.Fatalf("expected non-finite magnitudeScale fallback, got %f", options.MagnitudeScale)
	}
}

func containsClusterIndex(values []int, target int) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}
