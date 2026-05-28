package handlers

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

func (h *Handler) Analytics(c *gin.Context) {
	filters, ok := parseFilters(c)
	if !ok {
		return
	}

	analytics, err := h.repo.Analytics(c.Request.Context(), filters)
	if err != nil {
		if abortIfRequestCanceled(c, err) {
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, analytics)
}
