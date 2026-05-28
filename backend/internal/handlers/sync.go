package handlers

import (
	"errors"
	"net/http"

	"earthquake-big-data/backend/internal/jobs"
	"earthquake-big-data/backend/internal/models"

	"github.com/gin-gonic/gin"
)

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
		c.JSON(http.StatusNotFound, gin.H{"error": "job not found"})
		return
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
