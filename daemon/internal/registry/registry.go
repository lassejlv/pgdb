package registry

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"

	"pgdb/daemon/internal/model"
)

func EnsureDataDir(dataDir string) error {
	if err := os.MkdirAll(dataDir, 0o755); err != nil {
		return fmt.Errorf("create data dir: %w", err)
	}
	return nil
}

func Load(registryPath string) (model.Registry, error) {
	b, err := os.ReadFile(registryPath)
	if err != nil {
		if os.IsNotExist(err) {
			return model.Registry{Items: []model.DBInstance{}}, nil
		}
		return model.Registry{}, fmt.Errorf("read registry: %w", err)
	}

	if len(b) == 0 {
		return model.Registry{Items: []model.DBInstance{}}, nil
	}

	var r model.Registry
	if err := json.Unmarshal(b, &r); err != nil {
		return model.Registry{}, fmt.Errorf("parse registry json: %w", err)
	}
	if r.Items == nil {
		r.Items = []model.DBInstance{}
	}

	return r, nil
}

func Save(registryPath string, r model.Registry) error {
	dir := filepath.Dir(registryPath)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return fmt.Errorf("create registry dir: %w", err)
	}

	b, err := json.MarshalIndent(r, "", "  ")
	if err != nil {
		return fmt.Errorf("marshal registry: %w", err)
	}
	b = append(b, '\n')

	tmpPath := registryPath + ".tmp"
	if err := os.WriteFile(tmpPath, b, 0o600); err != nil {
		return fmt.Errorf("write temp registry: %w", err)
	}

	if err := os.Rename(tmpPath, registryPath); err != nil {
		return fmt.Errorf("replace registry atomically: %w", err)
	}

	return nil
}

func FindByName(r model.Registry, name string) (model.DBInstance, int) {
	for i, item := range r.Items {
		if item.Name == name {
			return item, i
		}
	}
	return model.DBInstance{}, -1
}
