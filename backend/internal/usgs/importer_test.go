package usgs

import (
	"testing"
	"time"

	"earthquake-big-data/backend/internal/models"
)

func TestQueryFiltersFromDashboardFiltersIncludesTsunamiValue(t *testing.T) {
	tsunami := 1
	start := time.Date(2005, 1, 1, 0, 0, 0, 0, time.UTC)
	end := time.Date(2008, 1, 1, 0, 0, 0, 0, time.UTC)

	queryFilters := queryFiltersFromDashboardFilters(models.Filters{
		Tsunami: &tsunami,
	}, start, end)

	if queryFilters.Tsunami == nil || *queryFilters.Tsunami != 1 {
		t.Fatalf("expected tsunami query filter, got %+v", queryFilters.Tsunami)
	}
}

func TestFilterCollectionForQueryKeepsOnlyMatchingTsunamiEvents(t *testing.T) {
	collection := models.USGSFeatureCollection{
		Type: "FeatureCollection",
		Features: []models.USGSFeature{
			{ID: "not-tsunami", Properties: models.USGSProperties{Tsunami: 0}},
			{ID: "tsunami", Properties: models.USGSProperties{Tsunami: 1}},
		},
	}
	tsunami := 1

	filtered := filterCollectionForQuery(collection, QueryFilters{Tsunami: &tsunami})

	if len(filtered.Features) != 1 {
		t.Fatalf("expected 1 tsunami feature, got %d", len(filtered.Features))
	}
	if filtered.Features[0].ID != "tsunami" {
		t.Fatalf("expected tsunami feature, got %q", filtered.Features[0].ID)
	}
}

func TestFilterCollectionForQueryKeepsOnlyNonTsunamiEvents(t *testing.T) {
	collection := models.USGSFeatureCollection{
		Type: "FeatureCollection",
		Features: []models.USGSFeature{
			{ID: "not-tsunami", Properties: models.USGSProperties{Tsunami: 0}},
			{ID: "tsunami", Properties: models.USGSProperties{Tsunami: 1}},
		},
	}
	tsunami := 0

	filtered := filterCollectionForQuery(collection, QueryFilters{Tsunami: &tsunami})

	if len(filtered.Features) != 1 {
		t.Fatalf("expected 1 non-tsunami feature, got %d", len(filtered.Features))
	}
	if filtered.Features[0].ID != "not-tsunami" {
		t.Fatalf("expected non-tsunami feature, got %q", filtered.Features[0].ID)
	}
}
