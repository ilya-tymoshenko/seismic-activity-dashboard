package jobs

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"reflect"
	"sync"
	"time"

	"earthquake-big-data/backend/internal/models"
	"earthquake-big-data/backend/internal/usgs"
)

const (
	importJobStatusQueued    = "queued"
	importJobStatusRunning   = "running"
	importJobStatusCanceling = "canceling"
	importJobStatusCanceled  = "canceled"
	importJobStatusSucceeded = "succeeded"
	importJobStatusFailed    = "failed"
)

var ErrImportJobAlreadyActive = errors.New("import job already active")

const SeedImportProgressStateKey = "usgs_seed_file_progress"

type ImportJobManager struct {
	ctx      context.Context
	importer *usgs.Importer
	mu       sync.RWMutex
	jobs     map[string]*importJobRecord
}

type importJobRecord struct {
	status models.ImportJobStatus
	cancel context.CancelFunc
}

func NewImportJobManager(ctx context.Context, importer *usgs.Importer) *ImportJobManager {
	return &ImportJobManager{
		ctx:      ctx,
		importer: importer,
		jobs:     make(map[string]*importJobRecord),
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
	jobCtx, cancel := context.WithCancel(m.ctx)
	m.store(status, cancel)

	go func() {
		summary, err := m.importer.SyncFeedWithProgress(jobCtx, feed, m.progressUpdater(id))
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
			Days:            days,
			MinMagnitude:    minMagnitude,
			HasMinMagnitude: true,
			ChunkDays:       chunkDays,
		},
		StartedAt: time.Now().UTC(),
	}
	jobCtx, cancel := context.WithCancel(m.ctx)
	status, started, err := m.storeImportJob(status, cancel)
	if err != nil {
		cancel()
		return models.ImportJobStatus{}, err
	}
	if !started {
		cancel()
		return status, nil
	}

	go func() {
		summary, err := m.importer.ImportHistoryWithProgress(jobCtx, days, minMagnitude, chunkDays, m.progressUpdater(id))
		m.finish(id, summary, err)
	}()

	return status, nil
}

func (m *ImportJobManager) StartFilteredImport(filters models.Filters, chunkDays int) (models.ImportJobStatus, error) {
	id, err := newImportJobID()
	if err != nil {
		return models.ImportJobStatus{}, err
	}
	status := models.ImportJobStatus{
		ID:        id,
		Kind:      "filter",
		Label:     "Load Filter Data",
		Status:    importJobStatusQueued,
		Message:   "Queued",
		Params:    importJobParamsFromFilters(filters, chunkDays),
		StartedAt: time.Now().UTC(),
	}
	jobCtx, cancel := context.WithCancel(m.ctx)
	status, started, err := m.storeImportJob(status, cancel)
	if err != nil {
		cancel()
		return models.ImportJobStatus{}, err
	}
	if !started {
		cancel()
		return status, nil
	}

	go func() {
		summary, err := m.importer.ImportFiltersWithProgress(jobCtx, filters, chunkDays, m.progressUpdater(id))
		m.finish(id, summary, err)
	}()

	return status, nil
}

func (m *ImportJobManager) RunSeedFile(ctx context.Context, path string, onStatus func(models.ImportJobStatus)) (models.ImportJobStatus, models.ImportSummary, error) {
	id, err := newImportJobID()
	if err != nil {
		return models.ImportJobStatus{}, models.ImportSummary{}, err
	}
	status := models.ImportJobStatus{
		ID:      id,
		Kind:    "seed",
		Label:   "Seed Import",
		Status:  importJobStatusQueued,
		Message: "Queued",
		Params: models.ImportJobParams{
			SeedFile: path,
		},
		StartedAt: time.Now().UTC(),
	}
	jobCtx, cancel := context.WithCancel(ctx)
	status, started, err := m.storeImportJob(status, cancel)
	if err != nil {
		cancel()
		return models.ImportJobStatus{}, models.ImportSummary{}, err
	}
	if !started {
		cancel()
		return status, status.Summary, ErrImportJobAlreadyActive
	}
	reportImportJobStatus(onStatus, status)

	progress := m.progressUpdater(id)
	summary, err := m.importer.ImportFileWithProgress(jobCtx, path, func(update models.ImportProgressUpdate) {
		progress(update)
		if current, ok := m.Get(id); ok {
			reportImportJobStatus(onStatus, current)
		}
	})
	m.finish(id, summary, err)

	finishedStatus, ok := m.Get(id)
	if ok {
		status = finishedStatus
	}
	reportImportJobStatus(onStatus, status)
	return status, summary, err
}

func (m *ImportJobManager) Get(id string) (models.ImportJobStatus, bool) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	record, ok := m.jobs[id]
	if !ok {
		return models.ImportJobStatus{}, false
	}
	return record.status, true
}

func (m *ImportJobManager) Active() (models.ImportJobStatus, bool) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	var active models.ImportJobStatus
	found := false
	for _, record := range m.jobs {
		if !isActiveImportJobStatus(record.status.Status) {
			continue
		}
		if !found || record.status.StartedAt.Before(active.StartedAt) {
			active = record.status
			found = true
		}
	}
	return active, found
}

func (m *ImportJobManager) Cancel(id string) (models.ImportJobStatus, bool) {
	m.mu.Lock()
	defer m.mu.Unlock()

	record, ok := m.jobs[id]
	if !ok {
		return models.ImportJobStatus{}, false
	}
	if !isActiveImportJobStatus(record.status.Status) {
		return record.status, true
	}
	record.status.Status = importJobStatusCanceling
	record.status.Message = "Cancel requested"
	record.cancel()
	return record.status, true
}

func (m *ImportJobManager) store(status models.ImportJobStatus, cancel context.CancelFunc) {
	m.mu.Lock()
	defer m.mu.Unlock()

	m.jobs[status.ID] = &importJobRecord{status: status, cancel: cancel}
}

func (m *ImportJobManager) storeImportJob(status models.ImportJobStatus, cancel context.CancelFunc) (models.ImportJobStatus, bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	if active, ok := m.activeJobLocked(status.Kind); ok {
		if reflect.DeepEqual(active.Params, status.Params) {
			return active, false, nil
		}
		return models.ImportJobStatus{}, false, ErrImportJobAlreadyActive
	}
	m.jobs[status.ID] = &importJobRecord{status: status, cancel: cancel}
	return status, true, nil
}

func (m *ImportJobManager) activeJobLocked(kind string) (models.ImportJobStatus, bool) {
	for _, record := range m.jobs {
		if record.status.Kind == kind && isActiveImportJobStatus(record.status.Status) {
			return record.status, true
		}
	}
	return models.ImportJobStatus{}, false
}

func isActiveImportJobStatus(status string) bool {
	return status == importJobStatusQueued || status == importJobStatusRunning || status == importJobStatusCanceling
}

func IsActiveImportJobStatus(status string) bool {
	return isActiveImportJobStatus(status)
}

func (m *ImportJobManager) progressUpdater(id string) usgs.ProgressCallback {
	return func(update models.ImportProgressUpdate) {
		m.mu.Lock()
		defer m.mu.Unlock()

		record, ok := m.jobs[id]
		if !ok {
			return
		}
		status := record.status
		if status.Status == importJobStatusCanceling {
			return
		}
		status.Status = importJobStatusRunning
		status.Progress = clampProgress(update.Progress)
		status.Message = update.Message
		status.CurrentStep = update.CurrentStep
		status.TotalSteps = update.TotalSteps
		status.Summary = update.Summary
		record.status = status
	}
}

func (m *ImportJobManager) finish(id string, summary models.ImportSummary, err error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	record, ok := m.jobs[id]
	if !ok {
		return
	}
	status := record.status
	finishedAt := time.Now().UTC()
	status.FinishedAt = &finishedAt
	status.Summary = summary
	if errors.Is(err, context.Canceled) {
		status.Status = importJobStatusCanceled
		status.Message = "Canceled"
		status.Error = ""
	} else if err != nil {
		status.Status = importJobStatusFailed
		status.Message = "Failed"
		status.Error = err.Error()
	} else {
		status.Status = importJobStatusSucceeded
		status.Message = "Completed"
		status.Progress = 100
	}
	record.status = status
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

func reportImportJobStatus(callback func(models.ImportJobStatus), status models.ImportJobStatus) {
	if callback != nil {
		callback(status)
	}
}

func importJobParamsFromFilters(filters models.Filters, chunkDays int) models.ImportJobParams {
	params := models.ImportJobParams{
		ChunkDays: chunkDays,
		Alert:     filters.Alert,
		Type:      filters.Type,
	}
	if filters.Tsunami != nil {
		tsunami := *filters.Tsunami
		params.Tsunami = &tsunami
		params.TsunamiOnly = tsunami == 1
	}
	if filters.DateFrom != nil {
		params.DateFrom = filters.DateFrom.UTC().Format("2006-01-02T15:04:05Z")
	}
	if filters.DateTo != nil {
		params.DateTo = filters.DateTo.UTC().Format("2006-01-02T15:04:05Z")
	}
	if filters.MinMagnitude != nil {
		params.MinMagnitude = *filters.MinMagnitude
		params.HasMinMagnitude = true
	}
	if filters.MaxMagnitude != nil {
		params.MaxMagnitude = *filters.MaxMagnitude
		params.HasMaxMagnitude = true
	}
	if filters.MinDepth != nil {
		params.MinDepth = *filters.MinDepth
		params.HasMinDepth = true
	}
	if filters.MaxDepth != nil {
		params.MaxDepth = *filters.MaxDepth
		params.HasMaxDepth = true
	}
	if filters.BBox != nil {
		params.BBoxMinLon = filters.BBox.MinLon
		params.BBoxMinLat = filters.BBox.MinLat
		params.BBoxMaxLon = filters.BBox.MaxLon
		params.BBoxMaxLat = filters.BBox.MaxLat
		params.HasBBox = true
	}
	return params
}
