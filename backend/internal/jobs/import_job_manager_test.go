package jobs

import (
	"errors"
	"testing"
	"time"

	"earthquake-big-data/backend/internal/models"
)

func TestStoreHistoryJobReturnsExistingActiveJobForMatchingParams(t *testing.T) {
	manager := &ImportJobManager{
		jobs: make(map[string]*importJobRecord),
	}

	params := models.ImportJobParams{
		Days:         3650,
		MinMagnitude: 2.5,
		ChunkDays:    30,
	}
	first := models.ImportJobStatus{
		ID:        "first",
		Kind:      "history",
		Status:    importJobStatusQueued,
		Params:    params,
		StartedAt: time.Now().UTC(),
	}
	second := models.ImportJobStatus{
		ID:        "second",
		Kind:      "history",
		Status:    importJobStatusQueued,
		Params:    params,
		StartedAt: time.Now().UTC(),
	}

	stored, started, err := manager.storeImportJob(first, func() {})
	if err != nil {
		t.Fatalf("expected first job to store without error, got %v", err)
	}
	if !started {
		t.Fatalf("expected first job to start")
	}
	if stored.ID != first.ID {
		t.Fatalf("expected first job id %q, got %q", first.ID, stored.ID)
	}

	stored, started, err = manager.storeImportJob(second, func() {})
	if err != nil {
		t.Fatalf("expected matching duplicate job to return active job, got %v", err)
	}
	if started {
		t.Fatalf("expected duplicate history job to be reused")
	}
	if stored.ID != first.ID {
		t.Fatalf("expected active job id %q, got %q", first.ID, stored.ID)
	}
	if _, ok := manager.jobs[second.ID]; ok {
		t.Fatalf("duplicate job was stored")
	}
}

func TestStoreHistoryJobRejectsDifferentParamsWhileActive(t *testing.T) {
	manager := &ImportJobManager{
		jobs: make(map[string]*importJobRecord),
	}

	first := models.ImportJobStatus{
		ID:     "first",
		Kind:   "history",
		Status: importJobStatusRunning,
		Params: models.ImportJobParams{
			Days:         3650,
			MinMagnitude: 2.5,
			ChunkDays:    30,
		},
		StartedAt: time.Now().UTC(),
	}
	second := models.ImportJobStatus{
		ID:     "second",
		Kind:   "history",
		Status: importJobStatusQueued,
		Params: models.ImportJobParams{
			Days:         30,
			MinMagnitude: 4,
			ChunkDays:    7,
		},
		StartedAt: time.Now().UTC(),
	}

	if _, _, err := manager.storeImportJob(first, func() {}); err != nil {
		t.Fatalf("expected first job to store without error, got %v", err)
	}
	_, started, err := manager.storeImportJob(second, func() {})
	if !errors.Is(err, ErrImportJobAlreadyActive) {
		t.Fatalf("expected active job conflict, got %v", err)
	}
	if started {
		t.Fatalf("expected conflicting job not to start")
	}
	if _, ok := manager.jobs[second.ID]; ok {
		t.Fatalf("conflicting job was stored")
	}
}

func TestStoreHistoryJobAllowsNewJobAfterCompletion(t *testing.T) {
	manager := &ImportJobManager{
		jobs: make(map[string]*importJobRecord),
	}

	finishedAt := time.Now().UTC()
	manager.jobs["finished"] = &importJobRecord{
		status: models.ImportJobStatus{
			ID:         "finished",
			Kind:       "history",
			Status:     importJobStatusSucceeded,
			Params:     models.ImportJobParams{Days: 3650, MinMagnitude: 2.5, ChunkDays: 30},
			StartedAt:  finishedAt,
			FinishedAt: &finishedAt,
		},
		cancel: func() {},
	}

	next := models.ImportJobStatus{
		ID:        "next",
		Kind:      "history",
		Status:    importJobStatusQueued,
		Params:    models.ImportJobParams{Days: 3650, MinMagnitude: 2.5, ChunkDays: 30},
		StartedAt: time.Now().UTC(),
	}

	stored, started, err := manager.storeImportJob(next, func() {})
	if err != nil {
		t.Fatalf("expected new job after completed history import, got %v", err)
	}
	if !started {
		t.Fatalf("expected new job after completed history import")
	}
	if stored.ID != next.ID {
		t.Fatalf("expected next job id %q, got %q", next.ID, stored.ID)
	}
}

func TestImportJobParamsFromFiltersIncludesBBox(t *testing.T) {
	params := importJobParamsFromFilters(models.Filters{
		BBox: &models.BBox{
			MinLon: -120.5,
			MinLat: 30.25,
			MaxLon: -60.5,
			MaxLat: 50.25,
		},
	}, 30)

	if !params.HasBBox {
		t.Fatalf("expected bbox flag")
	}
	if params.BBoxMinLon != -120.5 || params.BBoxMinLat != 30.25 || params.BBoxMaxLon != -60.5 || params.BBoxMaxLat != 50.25 {
		t.Fatalf("unexpected bbox params: %+v", params)
	}
}

func TestImportJobParamsFromFiltersDistinguishesTsunamiZeroFromNil(t *testing.T) {
	tsunami := 0
	params := importJobParamsFromFilters(models.Filters{
		Tsunami: &tsunami,
	}, 30)
	empty := importJobParamsFromFilters(models.Filters{}, 30)

	if params.Tsunami == nil {
		t.Fatalf("expected tsunami value for explicit tsunami=0")
	}
	if *params.Tsunami != 0 {
		t.Fatalf("expected tsunami=0, got %d", *params.Tsunami)
	}
	if params.TsunamiOnly {
		t.Fatalf("expected tsunamiOnly=false for explicit tsunami=0")
	}
	if params.Tsunami == empty.Tsunami {
		t.Fatalf("expected explicit tsunami=0 params to differ from no tsunami filter")
	}
}

func TestStoreFilterJobRejectsDifferentBBoxWhileActive(t *testing.T) {
	manager := &ImportJobManager{
		jobs: make(map[string]*importJobRecord),
	}

	first := models.ImportJobStatus{
		ID:     "first",
		Kind:   "filter",
		Status: importJobStatusRunning,
		Params: importJobParamsFromFilters(models.Filters{
			BBox: &models.BBox{MinLon: -120, MinLat: 30, MaxLon: -60, MaxLat: 50},
		}, 30),
		StartedAt: time.Now().UTC(),
	}
	second := models.ImportJobStatus{
		ID:     "second",
		Kind:   "filter",
		Status: importJobStatusQueued,
		Params: importJobParamsFromFilters(models.Filters{
			BBox: &models.BBox{MinLon: -10, MinLat: 40, MaxLon: 40, MaxLat: 70},
		}, 30),
		StartedAt: time.Now().UTC(),
	}

	if _, _, err := manager.storeImportJob(first, func() {}); err != nil {
		t.Fatalf("expected first job to store without error, got %v", err)
	}
	_, started, err := manager.storeImportJob(second, func() {})
	if !errors.Is(err, ErrImportJobAlreadyActive) {
		t.Fatalf("expected active job conflict, got %v", err)
	}
	if started {
		t.Fatalf("expected different bbox job not to start")
	}
	if _, ok := manager.jobs[second.ID]; ok {
		t.Fatalf("conflicting bbox job was stored")
	}
}

func TestCancelActiveJobUpdatesStatusAndCallsCancel(t *testing.T) {
	manager := &ImportJobManager{
		jobs: make(map[string]*importJobRecord),
	}
	called := false
	manager.jobs["sync"] = &importJobRecord{
		status: models.ImportJobStatus{
			ID:        "sync",
			Kind:      "sync",
			Status:    importJobStatusRunning,
			StartedAt: time.Now().UTC(),
		},
		cancel: func() {
			called = true
		},
	}

	status, ok := manager.Cancel("sync")
	if !ok {
		t.Fatalf("expected job to exist")
	}
	if !called {
		t.Fatalf("expected cancel func to be called")
	}
	if status.Status != importJobStatusCanceling {
		t.Fatalf("expected canceling status, got %q", status.Status)
	}
}

func TestFinishPreservesCancelingStatus(t *testing.T) {
	manager := &ImportJobManager{
		jobs: make(map[string]*importJobRecord),
	}
	manager.jobs["sync"] = &importJobRecord{
		status: models.ImportJobStatus{
			ID:        "sync",
			Kind:      "sync",
			Status:    importJobStatusCanceling,
			StartedAt: time.Now().UTC(),
		},
		cancel: func() {},
	}

	manager.finish("sync", models.ImportSummary{Processed: 10}, nil)

	status, ok := manager.Get("sync")
	if !ok {
		t.Fatalf("expected job to exist")
	}
	if status.Status != importJobStatusCanceled {
		t.Fatalf("expected canceled status, got %q", status.Status)
	}
	if status.Message != "Canceled" {
		t.Fatalf("expected canceled message, got %q", status.Message)
	}
}
