package main

import (
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"

	"pgdb/daemon/internal/api"
	"pgdb/daemon/internal/core"
	"pgdb/daemon/internal/docker"
	"pgdb/daemon/internal/registry"
)

func main() {
	logger := slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo}))

	listen := envOrDefault("PGDB_LISTEN", ":8080")
	dataDir := envOrDefault("PGDB_DATA_DIR", "/var/lib/pgdb")
	publicHost := envOrDefault("PGDB_PUBLIC_HOST", "")
	token := os.Getenv("PGDB_TOKEN")

	if token == "" {
		logger.Error("PGDB_TOKEN is required")
		os.Exit(1)
	}

	if err := registry.EnsureDataDir(dataDir); err != nil {
		logger.Error("failed to initialize data directory", "error", err)
		os.Exit(1)
	}

	registryPath := filepath.Join(dataDir, "registry.json")
	lockPath := filepath.Join(dataDir, "registry.lock")

	dockerClient := docker.NewClient()
	if err := dockerClient.EnsureAvailable(); err != nil {
		logger.Error("docker is not ready", "error", err)
		os.Exit(1)
	}

	handlers := &api.Handlers{
		Logger: logger,
		Deployer: &core.Deployer{
			RegistryPath: registryPath,
			LockPath:     lockPath,
			PublicHost:   publicHost,
			Docker:       dockerClient,
		},
		StatusSvc: &core.StatusService{
			RegistryPath: registryPath,
			LockPath:     lockPath,
		},
		Destroyer: &core.Destroyer{
			RegistryPath: registryPath,
			LockPath:     lockPath,
			Docker:       dockerClient,
		},
	}

	mux := http.NewServeMux()
	handlers.Register(mux, token)

	server := &http.Server{
		Addr:    listen,
		Handler: mux,
	}

	logger.Info("pgdbd started", "listen", listen, "data_dir", dataDir)
	if err := server.ListenAndServe(); err != nil {
		fmt.Fprintf(os.Stderr, "server error: %v\n", err)
		os.Exit(1)
	}
}

func envOrDefault(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}
