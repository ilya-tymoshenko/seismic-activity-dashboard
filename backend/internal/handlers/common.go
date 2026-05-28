package handlers

import (
	"context"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"earthquake-big-data/backend/internal/config"
	"earthquake-big-data/backend/internal/jobs"
	"earthquake-big-data/backend/internal/models"
	"earthquake-big-data/backend/internal/repository"
	usgsimport "earthquake-big-data/backend/internal/usgs"

	"github.com/gin-gonic/gin"
)

type Handler struct {
	repo       *repository.EarthquakeRepository
	importer   *usgsimport.Importer
	importJobs *jobs.ImportJobManager
	cfg        config.Config
}

func New(repo *repository.EarthquakeRepository, importer *usgsimport.Importer, importJobs *jobs.ImportJobManager, cfg config.Config) *Handler {
	return &Handler{repo: repo, importer: importer, importJobs: importJobs, cfg: cfg}
}

func (h *Handler) RegisterRoutes(router *gin.Engine) {
	api := router.Group("/api")
	api.GET("/health", h.Health)
	api.POST("/sync", h.Sync)
	api.POST("/import/history", h.ImportHistory)
	api.POST("/import/filter", h.ImportFilter)
	api.GET("/jobs/active", h.ActiveImportJob)
	api.GET("/jobs/:id", h.ImportJob)
	api.POST("/jobs/:id/cancel", h.CancelImportJob)
	api.GET("/earthquakes", h.Earthquakes)
	api.GET("/stats", h.Stats)
	api.GET("/analytics", h.Analytics)
}

func parseFilters(c *gin.Context) (models.Filters, bool) {
	var filters models.Filters
	var ok bool

	if filters.DateFrom, ok = parseDate(c.Query("dateFrom"), false, c); !ok {
		return filters, false
	}
	if filters.DateTo, ok = parseDate(c.Query("dateTo"), true, c); !ok {
		return filters, false
	}
	if filters.MinMagnitude, ok = parseFloatPtr(c.Query("minMagnitude"), "minMagnitude", c); !ok {
		return filters, false
	}
	if filters.MaxMagnitude, ok = parseFloatPtr(c.Query("maxMagnitude"), "maxMagnitude", c); !ok {
		return filters, false
	}
	if filters.MinDepth, ok = parseFloatPtr(c.Query("minDepth"), "minDepth", c); !ok {
		return filters, false
	}
	if filters.MaxDepth, ok = parseFloatPtr(c.Query("maxDepth"), "maxDepth", c); !ok {
		return filters, false
	}
	if tsunami := strings.TrimSpace(c.Query("tsunami")); tsunami != "" {
		value, err := strconv.Atoi(tsunami)
		if err != nil || (value != 0 && value != 1) {
			abortBadRequest(c, "tsunami must be 0 or 1")
			return filters, false
		}
		filters.Tsunami = &value
	}
	filters.Alert = strings.TrimSpace(c.Query("alert"))
	filters.Type = strings.TrimSpace(c.Query("type"))

	if bbox := strings.TrimSpace(c.Query("bbox")); bbox != "" {
		parsed, err := parseBBox(bbox)
		if err != nil {
			abortBadRequest(c, err.Error())
			return filters, false
		}
		filters.BBox = parsed
	}

	limit, err := parseIntDefault(c.Query("limit"), 1000)
	if err != nil {
		abortBadRequest(c, "limit must be an integer")
		return filters, false
	}
	filters.Limit = repository.ClampLimit(limit)
	return filters, true
}

func parseDate(value string, endOfDay bool, c *gin.Context) (*time.Time, bool) {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil, true
	}

	if parsed, err := time.Parse(time.RFC3339, value); err == nil {
		utc := parsed.UTC()
		return &utc, true
	}

	parsed, err := time.Parse("2006-01-02", value)
	if err != nil {
		abortBadRequest(c, "date must use YYYY-MM-DD or RFC3339 format")
		return nil, false
	}
	if endOfDay {
		parsed = parsed.Add(24*time.Hour - time.Nanosecond)
	}
	utc := parsed.UTC()
	return &utc, true
}

func parseFloatPtr(value string, name string, c *gin.Context) (*float64, bool) {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil, true
	}
	parsed, err := strconv.ParseFloat(value, 64)
	if err != nil {
		abortBadRequest(c, name+" must be a number")
		return nil, false
	}
	return &parsed, true
}

func parseFloatDefault(value string, fallback float64) (float64, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return fallback, nil
	}
	return strconv.ParseFloat(value, 64)
}

func parseIntDefault(value string, fallback int) (int, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return fallback, nil
	}
	return strconv.Atoi(value)
}

func parseBBox(value string) (*models.BBox, error) {
	parts := strings.Split(value, ",")
	if len(parts) != 4 {
		return nil, errMessage("bbox must use minLon,minLat,maxLon,maxLat")
	}

	values := make([]float64, 4)
	for index, part := range parts {
		parsed, err := strconv.ParseFloat(strings.TrimSpace(part), 64)
		if err != nil {
			return nil, errMessage("bbox values must be numbers")
		}
		values[index] = parsed
	}

	bbox := &models.BBox{
		MinLon: values[0],
		MinLat: values[1],
		MaxLon: values[2],
		MaxLat: values[3],
	}
	if bbox.MinLon < -180 || bbox.MaxLon > 180 || bbox.MinLat < -90 || bbox.MaxLat > 90 || bbox.MinLon >= bbox.MaxLon || bbox.MinLat >= bbox.MaxLat {
		return nil, errMessage("bbox values are outside valid coordinate ranges")
	}
	return bbox, nil
}

func abortBadRequest(c *gin.Context, message string) {
	c.AbortWithStatusJSON(http.StatusBadRequest, gin.H{"error": message})
}

const statusClientClosedRequest = 499

func abortIfRequestCanceled(c *gin.Context, err error) bool {
	if err == nil {
		return false
	}
	if c.Request.Context().Err() != nil || errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
		c.AbortWithStatus(statusClientClosedRequest)
		return true
	}
	return false
}

type errMessage string

func (e errMessage) Error() string {
	return string(e)
}
