package jobs

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"log"
	"os"
	"time"

	"earthquake-big-data/backend/internal/config"
	"earthquake-big-data/backend/internal/models"
	"earthquake-big-data/backend/internal/repository"
	"earthquake-big-data/backend/internal/usgs"
)

const seedImportStateKey = "usgs_seed_file_sha256"

type USGSRunner struct {
	cfg        config.Config
	repo       *repository.EarthquakeRepository
	importer   *usgs.Importer
	importJobs *ImportJobManager
}

func NewUSGSRunner(cfg config.Config, repo *repository.EarthquakeRepository, importer *usgs.Importer, importJobs *ImportJobManager) *USGSRunner {
	return &USGSRunner{cfg: cfg, repo: repo, importer: importer, importJobs: importJobs}
}

func (r *USGSRunner) Start(ctx context.Context) {
	go r.run(ctx)
}

func (r *USGSRunner) run(ctx context.Context) {
	if r.cfg.USGSSeedImportEnabled {
		r.runSeedImport(ctx)
	} else {
		log.Printf("USGS seed import disabled: USGS_SEED_IMPORT_ENABLED=false")
		r.logDatabaseStatus(ctx, "seed disabled")
	}
	if r.cfg.USGSSyncEnabled {
		r.runSyncLoop(ctx)
	}
}

func (r *USGSRunner) runSeedImport(ctx context.Context) {
	log.Printf("USGS seed import status: enabled=true file=%s", r.cfg.USGSSeedFile)
	checksum, err := fileSHA256(r.cfg.USGSSeedFile)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			log.Printf("USGS seed import skipped: file %s does not exist", r.cfg.USGSSeedFile)
			r.logDatabaseStatus(ctx, "seed file missing")
			return
		}
		log.Printf("USGS seed import skipped: cannot read %s: %v", r.cfg.USGSSeedFile, err)
		r.logDatabaseStatus(ctx, "seed file unreadable")
		return
	}
	if info, statErr := os.Stat(r.cfg.USGSSeedFile); statErr == nil {
		log.Printf("USGS seed import file: path=%s size_bytes=%d sha256=%s", r.cfg.USGSSeedFile, info.Size(), checksum)
	} else {
		log.Printf("USGS seed import file: path=%s sha256=%s stat_error=%v", r.cfg.USGSSeedFile, checksum, statErr)
	}

	previousChecksum, imported, err := r.repo.ImportState(ctx, seedImportStateKey)
	if err != nil {
		log.Printf("USGS seed import state check failed: %v", err)
		r.logDatabaseStatus(ctx, "seed state check failed")
		return
	}
	log.Printf("USGS seed import state: imported=%t previous_sha256=%s current_sha256=%s", imported, previousChecksum, checksum)
	if imported && previousChecksum == checksum {
		log.Printf("USGS seed import skipped: %s already imported", r.cfg.USGSSeedFile)
		r.logDatabaseStatus(ctx, "seed already imported")
		return
	}

	log.Printf("USGS seed import started: file=%s sha256=%s", r.cfg.USGSSeedFile, checksum)
	_, summary, err := r.importJobs.RunSeedFile(ctx, r.cfg.USGSSeedFile, func(status models.ImportJobStatus) {
		r.persistSeedImportProgress(ctx, status)
	})
	if err != nil {
		log.Printf("USGS seed import failed: %v", err)
		r.logDatabaseStatus(ctx, "seed import failed")
		return
	}
	log.Printf(
		"USGS seed import complete: fetched=%d processed=%d skipped=%d errors=%d",
		summary.Fetched,
		summary.Processed,
		summary.Skipped,
		summary.Errors,
	)
	if summary.Errors > 0 {
		log.Printf("USGS seed import incomplete: checksum state not updated because %d rows failed", summary.Errors)
		r.logDatabaseStatus(ctx, "seed import incomplete")
		return
	}
	if err := r.repo.SetImportState(ctx, seedImportStateKey, checksum); err != nil {
		log.Printf("USGS seed import state update failed: %v", err)
		r.logDatabaseStatus(ctx, "seed state update failed")
		return
	}
	log.Printf("USGS seed import state updated: key=%s sha256=%s", seedImportStateKey, checksum)
	r.logDatabaseStatus(ctx, "seed import complete")
}

func (r *USGSRunner) persistSeedImportProgress(ctx context.Context, status models.ImportJobStatus) {
	payload, err := json.Marshal(status)
	if err != nil {
		log.Printf("USGS seed import progress marshal failed: %v", err)
		return
	}
	persistCtx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	if err := r.repo.SetImportState(persistCtx, SeedImportProgressStateKey, string(payload)); err != nil {
		log.Printf("USGS seed import progress update failed: %v", err)
	}
}

func (r *USGSRunner) runSyncLoop(ctx context.Context) {
	r.syncOnce(ctx, "startup")

	ticker := time.NewTicker(r.cfg.USGSSyncInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			r.syncOnce(ctx, "scheduled")
		}
	}
}

func (r *USGSRunner) syncOnce(ctx context.Context, reason string) {
	summary, err := r.importer.SyncFeed(ctx, r.cfg.USGSSyncFeed)
	if refreshErr := r.refreshBIAfterImport(summary, err); refreshErr != nil {
		log.Printf("USGS %s sync BI refresh failed: %v", reason, refreshErr)
	}
	if err != nil {
		log.Printf(
			"USGS %s sync failed: feed=%s fetched=%d processed=%d skipped=%d errors=%d error=%v",
			reason,
			r.cfg.USGSSyncFeed,
			summary.Fetched,
			summary.Processed,
			summary.Skipped,
			summary.Errors,
			err,
		)
		return
	}
	log.Printf(
		"USGS %s sync complete: feed=%s fetched=%d processed=%d skipped=%d errors=%d",
		reason,
		r.cfg.USGSSyncFeed,
		summary.Fetched,
		summary.Processed,
		summary.Skipped,
		summary.Errors,
	)
}

func (r *USGSRunner) refreshBIAfterImport(summary models.ImportSummary, importErr error) error {
	if importErr != nil && summary.Processed == 0 {
		return nil
	}
	refreshCtx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	if err := r.repo.RefreshBIMaterializedViews(refreshCtx); err != nil {
		return err
	}
	return nil
}

func fileSHA256(path string) (string, error) {
	file, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer file.Close()

	hash := sha256.New()
	if _, err := io.Copy(hash, file); err != nil {
		return "", err
	}
	return hex.EncodeToString(hash.Sum(nil)), nil
}

func (r *USGSRunner) logDatabaseStatus(ctx context.Context, reason string) {
	total, oldest, newest, err := r.repo.EventInventory(ctx)
	if err != nil {
		log.Printf("USGS seed database status unavailable: reason=%q error=%v", reason, err)
		return
	}
	log.Printf(
		"USGS seed database status: reason=%q total_events=%d oldest=%s newest=%s",
		reason,
		total,
		formatOptionalTime(oldest),
		formatOptionalTime(newest),
	)
}

func formatOptionalTime(value *time.Time) string {
	if value == nil {
		return "n/a"
	}
	return value.UTC().Format(time.RFC3339)
}
