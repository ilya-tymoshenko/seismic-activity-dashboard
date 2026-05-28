package jobs

import (
	"errors"
	"testing"
	"time"

	"earthquake-big-data/backend/internal/models"
)

func TestStoreHistoryJobReturnsExistingActiveJobForMatchingParams(t *testing.T) {
	manager := &ImportJobManager{
		jobs: make(map[string]models.ImportJobStatus),
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

	stored, started, err := manager.storeHistoryJob(first)
	if err != nil {
		t.Fatalf("expected first job to store without error, got %v", err)
	}
	if !started {
		t.Fatalf("expected first job to start")
	}
	if stored.ID != first.ID {
		t.Fatalf("expected first job id %q, got %q", first.ID, stored.ID)
	}

	stored, started, err = manager.storeHistoryJob(second)
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
		jobs: make(map[string]models.ImportJobStatus),
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

	if _, _, err := manager.storeHistoryJob(first); err != nil {
		t.Fatalf("expected first job to store without error, got %v", err)
	}
	_, started, err := manager.storeHistoryJob(second)
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
		jobs: make(map[string]models.ImportJobStatus),
	}

	finishedAt := time.Now().UTC()
	manager.jobs["finished"] = models.ImportJobStatus{
		ID:         "finished",
		Kind:       "history",
		Status:     importJobStatusSucceeded,
		Params:     models.ImportJobParams{Days: 3650, MinMagnitude: 2.5, ChunkDays: 30},
		StartedAt:  finishedAt,
		FinishedAt: &finishedAt,
	}

	next := models.ImportJobStatus{
		ID:        "next",
		Kind:      "history",
		Status:    importJobStatusQueued,
		Params:    models.ImportJobParams{Days: 3650, MinMagnitude: 2.5, ChunkDays: 30},
		StartedAt: time.Now().UTC(),
	}

	stored, started, err := manager.storeHistoryJob(next)
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
