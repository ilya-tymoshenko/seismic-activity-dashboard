package jobs

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"sync"
	"time"

	"earthquake-big-data/backend/internal/models"
	"earthquake-big-data/backend/internal/usgs"
)

const (
	importJobStatusQueued    = "queued"
	importJobStatusRunning   = "running"
	importJobStatusSucceeded = "succeeded"
	importJobStatusFailed    = "failed"
)

var ErrImportJobAlreadyActive = errors.New("import job already active")

type ImportJobManager struct {
	ctx      context.Context
	importer *usgs.Importer
	mu       sync.RWMutex
	jobs     map[string]models.ImportJobStatus
}

func NewImportJobManager(ctx context.Context, importer *usgs.Importer) *ImportJobManager {
	return &ImportJobManager{
		ctx:      ctx,
		importer: importer,
		jobs:     make(map[string]models.ImportJobStatus),
	}
}

func (m *ImportJobManager) StartSync(feed string) (models.ImportJobStatus, error) {
	id, err := newImportJobID()
	if err != nil {
		return models.ImportJobStatus{}, err
	}
	status := models.ImportJobStatus{
		ID:      id,
		Kind:    "sync",
		Label:   "Sync Data",
		Status:  importJobStatusQueued,
		Message: "Queued",
		Params: models.ImportJobParams{
			Feed: feed,
		},
		StartedAt: time.Now().UTC(),
	}
	m.store(status)

	go func() {
		summary, err := m.importer.SyncFeedWithProgress(m.ctx, feed, m.progressUpdater(id))
		m.finish(id, summary, err)
	}()

	return status, nil
}

func (m *ImportJobManager) StartHistory(days int, minMagnitude float64, chunkDays int) (models.ImportJobStatus, error) {
	id, err := newImportJobID()
	if err != nil {
		return models.ImportJobStatus{}, err
	}
	status := models.ImportJobStatus{
		ID:      id,
		Kind:    "history",
		Label:   "Import History",
		Status:  importJobStatusQueued,
		Message: "Queued",
		Params: models.ImportJobParams{
			Days:         days,
			MinMagnitude: minMagnitude,
			ChunkDays:    chunkDays,
		},
		StartedAt: time.Now().UTC(),
	}
	status, started, err := m.storeHistoryJob(status)
	if err != nil {
		return models.ImportJobStatus{}, err
	}
	if !started {
		return status, nil
	}

	go func() {
		summary, err := m.importer.ImportHistoryWithProgress(m.ctx, days, minMagnitude, chunkDays, m.progressUpdater(id))
		m.finish(id, summary, err)
	}()

	return status, nil
}

func (m *ImportJobManager) Get(id string) (models.ImportJobStatus, bool) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	status, ok := m.jobs[id]
	return status, ok
}

func (m *ImportJobManager) store(status models.ImportJobStatus) {
	m.mu.Lock()
	defer m.mu.Unlock()

	m.jobs[status.ID] = status
}

func (m *ImportJobManager) storeHistoryJob(status models.ImportJobStatus) (models.ImportJobStatus, bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	if active, ok := m.activeJobLocked(status.Kind); ok {
		if active.Params == status.Params {
			return active, false, nil
		}
		return models.ImportJobStatus{}, false, ErrImportJobAlreadyActive
	}
	m.jobs[status.ID] = status
	return status, true, nil
}

func (m *ImportJobManager) activeJobLocked(kind string) (models.ImportJobStatus, bool) {
	for _, status := range m.jobs {
		if status.Kind == kind && isActiveImportJobStatus(status.Status) {
			return status, true
		}
	}
	return models.ImportJobStatus{}, false
}

func isActiveImportJobStatus(status string) bool {
	return status == importJobStatusQueued || status == importJobStatusRunning
}

func (m *ImportJobManager) progressUpdater(id string) usgs.ProgressCallback {
	return func(update models.ImportProgressUpdate) {
		m.mu.Lock()
		defer m.mu.Unlock()

		status, ok := m.jobs[id]
		if !ok {
			return
		}
		status.Status = importJobStatusRunning
		status.Progress = clampProgress(update.Progress)
		status.Message = update.Message
		status.CurrentStep = update.CurrentStep
		status.TotalSteps = update.TotalSteps
		status.Summary = update.Summary
		m.jobs[id] = status
	}
}

func (m *ImportJobManager) finish(id string, summary models.ImportSummary, err error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	status, ok := m.jobs[id]
	if !ok {
		return
	}
	finishedAt := time.Now().UTC()
	status.FinishedAt = &finishedAt
	status.Summary = summary
	if err != nil {
		status.Status = importJobStatusFailed
		status.Message = "Failed"
		status.Error = err.Error()
	} else {
		status.Status = importJobStatusSucceeded
		status.Message = "Completed"
		status.Progress = 100
	}
	m.jobs[id] = status
}

func newImportJobID() (string, error) {
	var bytes [8]byte
	if _, err := rand.Read(bytes[:]); err != nil {
		return "", fmt.Errorf("generate job id: %w", err)
	}
	return hex.EncodeToString(bytes[:]), nil
}

func clampProgress(progress float64) float64 {
	if progress < 0 {
		return 0
	}
	if progress > 100 {
		return 100
	}
	return progress
}
