package core

import (
	"fmt"
	"net/url"

	"pgdb/daemon/internal/model"
	"pgdb/daemon/internal/registry"
)

type StatusService struct {
	RegistryPath string
	LockPath     string
}

func (s *StatusService) Status() (model.StatusResponse, error) {
	unlock, err := registry.AcquireLock(s.LockPath)
	if err != nil {
		return model.StatusResponse{}, err
	}
	defer func() { _ = unlock() }()

	r, err := registry.Load(s.RegistryPath)
	if err != nil {
		return model.StatusResponse{}, err
	}

	items := make([]model.StatusItem, 0, len(r.Items))
	for _, it := range r.Items {
		items = append(items, model.StatusItem{
			Name:            it.Name,
			ContainerID:     it.ContainerID,
			VolumeName:      it.VolumeName,
			Host:            it.Host,
			HostPort:        it.HostPort,
			DB:              it.DB,
			User:            it.User,
			Password:        it.Password,
			CreatedAt:       it.CreatedAt,
			PostgresVersion: it.PostgresVersion,
			DatabaseURL:     makeDatabaseURLForStatus(it),
		})
	}

	return model.StatusResponse{Items: items}, nil
}

func makeDatabaseURLForStatus(item model.DBInstance) string {
	user := url.QueryEscape(item.User)
	pass := url.QueryEscape(item.Password)
	db := url.PathEscape(item.DB)
	return fmt.Sprintf("postgres://%s:%s@%s:%d/%s?sslmode=disable", user, pass, item.Host, item.HostPort, db)
}
