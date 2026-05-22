package main

import (
	"log"
	"time"

	"earthquake-big-data/backend/internal/config"
	dbconn "earthquake-big-data/backend/internal/db"
	"earthquake-big-data/backend/internal/handlers"
	"earthquake-big-data/backend/internal/repository"
	"earthquake-big-data/backend/internal/usgs"

	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
)

func main() {
	cfg := config.Load()

	gormDB, sqlDB, err := dbconn.Connect(cfg)
	if err != nil {
		log.Fatalf("database connection failed: %v", err)
	}
	_ = gormDB
	defer sqlDB.Close()

	repo := repository.NewEarthquakeRepository(sqlDB)
	usgsClient := usgs.NewClient(cfg.HTTPTimeout)
	importer := usgs.NewImporter(usgsClient, repo)
	handler := handlers.New(repo, importer, cfg)

	router := gin.Default()
	router.Use(cors.New(cors.Config{
		AllowOrigins:     cfg.CORSAllowedOrigins,
		AllowMethods:     []string{"GET", "POST", "OPTIONS"},
		AllowHeaders:     []string{"Origin", "Content-Type", "Accept"},
		AllowCredentials: false,
		MaxAge:           12 * time.Hour,
	}))
	handler.RegisterRoutes(router)

	log.Printf("earthquake backend listening on :%s", cfg.AppPort)
	if err := router.Run(":" + cfg.AppPort); err != nil {
		log.Fatalf("server failed: %v", err)
	}
}
