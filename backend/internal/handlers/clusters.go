package handlers

import (
	"math"
	"net/http"
	"strings"

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

	mode := strings.ToLower(strings.TrimSpace(c.DefaultQuery("mode", "hybrid")))
	epsDefault := 1.0
	if mode == "spatial" {
		epsDefault = 2.0
	}
	eps, err := parseFloatDefault(c.Query("eps"), epsDefault)
	if err != nil {
		abortBadRequest(c, "eps must be a number")
		return
	}
	if !isFinite(eps) {
		abortBadRequest(c, "eps must be finite")
		return
	}
	if eps > models.MaxClusterEps {
		abortBadRequest(c, "eps is too large")
		return
	}
	minPoints, err := parseIntDefault(c.Query("minPoints"), 10)
	if err != nil {
		abortBadRequest(c, "minPoints must be an integer")
		return
	}
	if minPoints > models.MaxClusterMinPoints {
		abortBadRequest(c, "minPoints is too large")
		return
	}
	spatialEpsKm, err := parseFloatDefault(c.Query("spatialEpsKm"), 300)
	if err != nil {
		abortBadRequest(c, "spatialEpsKm must be a number")
		return
	}
	if !isFinite(spatialEpsKm) {
		abortBadRequest(c, "spatialEpsKm must be finite")
		return
	}
	if spatialEpsKm > models.MaxClusterSpatialEpsKm {
		abortBadRequest(c, "spatialEpsKm is too large")
		return
	}
	depthScaleKm, err := parseFloatDefault(c.Query("depthScaleKm"), 100)
	if err != nil {
		abortBadRequest(c, "depthScaleKm must be a number")
		return
	}
	if !isFinite(depthScaleKm) {
		abortBadRequest(c, "depthScaleKm must be finite")
		return
	}
	if depthScaleKm > models.MaxClusterDepthScaleKm {
		abortBadRequest(c, "depthScaleKm is too large")
		return
	}
	magnitudeScale, err := parseFloatDefault(c.Query("magnitudeScale"), 1)
	if err != nil {
		abortBadRequest(c, "magnitudeScale must be a number")
		return
	}
	if !isFinite(magnitudeScale) {
		abortBadRequest(c, "magnitudeScale must be finite")
		return
	}
	if magnitudeScale > models.MaxClusterMagnitudeScale {
		abortBadRequest(c, "magnitudeScale is too large")
		return
	}

	clusters, err := h.repo.Clusters(c.Request.Context(), filters, models.ClusterOptions{
		Mode:           mode,
		Eps:            eps,
		MinPoints:      minPoints,
		SpatialEpsKm:   spatialEpsKm,
		DepthScaleKm:   depthScaleKm,
		MagnitudeScale: magnitudeScale,
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, models.ClustersResponse{Data: clusters})
}

func isFinite(value float64) bool {
	return !math.IsNaN(value) && !math.IsInf(value, 0)
}
