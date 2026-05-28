package main

import (
	"context"
	"errors"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"earthquake-big-data/backend/internal/config"
	dbconn "earthquake-big-data/backend/internal/db"
	"earthquake-big-data/backend/internal/handlers"
	"earthquake-big-data/backend/internal/jobs"
	"earthquake-big-data/backend/internal/repository"
	"earthquake-big-data/backend/internal/usgs"

	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
)

func main() {
	cfg := config.Load()
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

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
	jobs.NewUSGSRunner(cfg, repo, importer).Start(ctx)

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
	server := &http.Server{
		Addr:    ":" + cfg.AppPort,
		Handler: router,
	}
	serverErr := make(chan error, 1)
	go func() {
		serverErr <- server.ListenAndServe()
	}()

	select {
	case err := <-serverErr:
		if err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatalf("server failed: %v", err)
		}
		return
	case <-ctx.Done():
	}

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := server.Shutdown(shutdownCtx); err != nil {
		log.Printf("server shutdown failed: %v", err)
	}
	if err := <-serverErr; err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatalf("server failed: %v", err)
	}
}
