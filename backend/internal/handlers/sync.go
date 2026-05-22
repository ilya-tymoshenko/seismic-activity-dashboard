package handlers

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

func (h *Handler) Sync(c *gin.Context) {
	feed := c.DefaultQuery("feed", h.cfg.USGSSyncFeed)
	summary, err := h.importer.SyncFeed(c.Request.Context(), feed)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, summary)
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

	summary, err := h.importer.ImportHistory(c.Request.Context(), days, minMagnitude, chunkDays)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{
			"error":   err.Error(),
			"summary": summary,
		})
		return
	}
	c.JSON(http.StatusOK, summary)
}
