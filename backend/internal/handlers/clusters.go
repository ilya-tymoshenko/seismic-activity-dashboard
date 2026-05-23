package handlers

import (
	"net/http"

	"earthquake-big-data/backend/internal/models"

	"github.com/gin-gonic/gin"
)

func (h *Handler) Clusters(c *gin.Context) {
	filters, ok := parseFilters(c)
	if !ok {
		return
	}
	if filters.MinMagnitude == nil && filters.MaxMagnitude == nil {
		defaultMinMagnitude := 4.5
		filters.MinMagnitude = &defaultMinMagnitude
	}

	eps, err := parseFloatDefault(c.Query("eps"), 2.0)
	if err != nil {
		abortBadRequest(c, "eps must be a number")
		return
	}
	minPoints, err := parseIntDefault(c.Query("minPoints"), 10)
	if err != nil {
		abortBadRequest(c, "minPoints must be an integer")
		return
	}

	clusters, err := h.repo.Clusters(c.Request.Context(), filters, eps, minPoints)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, models.ClustersResponse{Data: clusters})
}
