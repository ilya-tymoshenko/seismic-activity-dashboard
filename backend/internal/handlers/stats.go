package handlers

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

func (h *Handler) Stats(c *gin.Context) {
	filters, ok := parseFilters(c)
	if !ok {
		return
	}

	stats, err := h.repo.Stats(c.Request.Context(), filters)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, stats)
}
