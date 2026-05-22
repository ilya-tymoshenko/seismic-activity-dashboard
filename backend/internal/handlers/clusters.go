package handlers

import (
	"net/http"

	"earthquake-big-data/backend/internal/models"

	"github.com/gin-gonic/gin"
)

func (h *Handler) Clusters(c *gin.Context) {
	minMagnitude, err := parseFloatDefault(c.Query("minMagnitude"), 4.5)
	if err != nil {
		abortBadRequest(c, "minMagnitude must be a number")
		return
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
	dateFrom, ok := parseDate(c.Query("dateFrom"), false, c)
	if !ok {
		return
	}
	dateTo, ok := parseDate(c.Query("dateTo"), true, c)
	if !ok {
		return
	}

	clusters, err := h.repo.Clusters(c.Request.Context(), minMagnitude, eps, minPoints, dateFrom, dateTo)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, models.ClustersResponse{Data: clusters})
}
