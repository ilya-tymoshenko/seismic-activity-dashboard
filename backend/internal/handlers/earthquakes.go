package handlers

import (
	"net/http"

	"earthquake-big-data/backend/internal/models"

	"github.com/gin-gonic/gin"
)

func (h *Handler) Earthquakes(c *gin.Context) {
	filters, ok := parseFilters(c)
	if !ok {
		return
	}

	data, err := h.repo.ListEarthquakes(c.Request.Context(), filters)
	if err != nil {
		if abortIfRequestCanceled(c, err) {
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, models.EarthquakesResponse{
		Data: data,
		Meta: models.Meta{
			Limit:    filters.Limit,
			Returned: len(data),
		},
	})
}
