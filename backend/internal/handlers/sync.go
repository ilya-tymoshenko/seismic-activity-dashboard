package handlers

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"earthquake-big-data/backend/internal/jobs"
	"earthquake-big-data/backend/internal/models"

	"github.com/gin-gonic/gin"
)

const persistedSeedProgressMaxAge = 2 * time.Minute

func (h *Handler) Sync(c *gin.Context) {
	feed := c.DefaultQuery("feed", h.cfg.USGSSyncFeed)
	status, err := h.importJobs.StartSync(feed)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusAccepted, models.ImportJobStartResponse{
		JobID:  status.ID,
		Status: status,
	})
}

func (h *Handler) ImportHistory(c *gin.Context) {
	days, err := parseIntDefault(c.Query("days"), h.cfg.USGSHistoryDays)
	if err != nil {
		abortBadRequest(c, "days must be an integer")
		return
	}
	minMagnitude, err := parseFloatDefault(c.Query("minMagnitude"), h.cfg.USGSMinMagnitude)
	if err != nil {
		abortBadRequest(c, "minMagnitude must be a number")
		return
	}
	chunkDays, err := parseIntDefault(c.Query("chunkDays"), h.cfg.USGSHistoryChunkDays)
	if err != nil {
		abortBadRequest(c, "chunkDays must be an integer")
		return
	}

	status, err := h.importJobs.StartHistory(days, minMagnitude, chunkDays)
	if err != nil {
		if errors.Is(err, jobs.ErrImportJobAlreadyActive) {
			c.JSON(http.StatusConflict, gin.H{"error": "history import is already running with different parameters"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusAccepted, models.ImportJobStartResponse{
		JobID:  status.ID,
		Status: status,
	})
}

func (h *Handler) ImportFilter(c *gin.Context) {
	filters, ok := parseFilters(c)
	if !ok {
		return
	}
	if filters.DateFrom == nil || filters.DateTo == nil {
		abortBadRequest(c, "dateFrom and dateTo are required")
		return
	}
	chunkDays, err := parseIntDefault(c.Query("chunkDays"), h.cfg.USGSHistoryChunkDays)
	if err != nil {
		abortBadRequest(c, "chunkDays must be an integer")
		return
	}

	status, err := h.importJobs.StartFilteredImport(filters, chunkDays)
	if err != nil {
		if errors.Is(err, jobs.ErrImportJobAlreadyActive) {
			c.JSON(http.StatusConflict, gin.H{"error": "filtered import is already running with different parameters"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusAccepted, models.ImportJobStartResponse{
		JobID:  status.ID,
		Status: status,
	})
}

func (h *Handler) ImportJob(c *gin.Context) {
	status, ok := h.importJobs.Get(c.Param("id"))
	if !ok {
		var err error
		status, ok, err = h.persistedSeedImportJob(c.Request.Context(), c.Param("id"))
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		if !ok {
			c.JSON(http.StatusNotFound, gin.H{"error": "job not found"})
			return
		}
	}
	c.JSON(http.StatusOK, status)
}

func (h *Handler) ActiveImportJob(c *gin.Context) {
	status, ok := h.importJobs.Active()
	if !ok {
		c.JSON(http.StatusNotFound, gin.H{"error": "no active import job"})
		return
	}
	c.JSON(http.StatusOK, status)
}

func (h *Handler) CancelImportJob(c *gin.Context) {
	status, ok := h.importJobs.Cancel(c.Param("id"))
	if !ok {
		c.JSON(http.StatusNotFound, gin.H{"error": "job not found"})
		return
	}
	c.JSON(http.StatusOK, status)
}

func (h *Handler) persistedSeedImportJob(ctx context.Context, id string) (models.ImportJobStatus, bool, error) {
	status, updatedAt, ok, err := h.persistedSeedImportProgress(ctx)
	if err != nil || !ok {
		return status, ok, err
	}
	if status.ID != id || jobs.IsActiveImportJobStatus(status.Status) || stalePersistedSeedProgress(updatedAt) {
		return models.ImportJobStatus{}, false, nil
	}
	return status, true, nil
}

func (h *Handler) persistedSeedImportProgress(ctx context.Context) (models.ImportJobStatus, time.Time, bool, error) {
	value, updatedAt, ok, err := h.repo.ImportStateWithUpdatedAt(ctx, jobs.SeedImportProgressStateKey)
	if err != nil || !ok {
		return models.ImportJobStatus{}, time.Time{}, ok, err
	}

	var status models.ImportJobStatus
	if err := json.Unmarshal([]byte(value), &status); err != nil {
		return models.ImportJobStatus{}, time.Time{}, false, err
	}
	if status.Kind != "seed" {
		return models.ImportJobStatus{}, time.Time{}, false, nil
	}
	return status, updatedAt, true, nil
}

func stalePersistedSeedProgress(updatedAt time.Time) bool {
	return time.Since(updatedAt) > persistedSeedProgressMaxAge
}
