package core

import (
	"fmt"
	"net"
	"net/url"
	"regexp"
	"strings"
	"time"

	"pgdb/daemon/internal/docker"
	"pgdb/daemon/internal/model"
	"pgdb/daemon/internal/registry"
	"pgdb/daemon/internal/util"
)

var deployNameRe = regexp.MustCompile(`^[a-z][a-z0-9-]{2,62}$`)

type Deployer struct {
	RegistryPath string
	LockPath     string
	PublicHost   string
	Docker       *docker.Client
}

func (d *Deployer) Deploy(req model.DeployRequest, requestHost string) (model.DeployResponse, error) {
	unlock, err := registry.AcquireLock(d.LockPath)
	if err != nil {
		return model.DeployResponse{}, err
	}
	defer func() { _ = unlock() }()

	r, err := registry.Load(d.RegistryPath)
	if err != nil {
		return model.DeployResponse{}, err
	}

	name, err := normalizeOrGenerateName(req.Name)
	if err != nil {
		return model.DeployResponse{}, err
	}

	if _, idx := registry.FindByName(r, name); idx >= 0 {
		return model.DeployResponse{}, fmt.Errorf("database name '%s' already exists", name)
	}

	version := req.Version
	if version == 0 {
		version = 16
	}
	if version < 12 || version > 17 {
		return model.DeployResponse{}, fmt.Errorf("version must be between 12 and 17")
	}

	dbSuffix, err := util.RandomLowerAlphaNum(10)
	if err != nil {
		return model.DeployResponse{}, err
	}
	userSuffix, err := util.RandomLowerAlphaNum(10)
	if err != nil {
		return model.DeployResponse{}, err
	}
	password, err := util.RandomPassword(24)
	if err != nil {
		return model.DeployResponse{}, err
	}

	dbName := "pg_" + dbSuffix
	username := "u_" + userSuffix
	containerName := "pgdb-" + name
	volumeName := "pgdb-" + name
	host := deriveHost(d.PublicHost, requestHost)
	createdAt := util.NowRFC3339()

	var lastErr error
	for attempt := 1; attempt <= 5; attempt++ {
		hostPort, err := reservePort()
		if err != nil {
			return model.DeployResponse{}, err
		}

		if err := d.Docker.CreateVolume(volumeName); err != nil {
			return model.DeployResponse{}, err
		}

		containerID, runErr := d.Docker.RunPostgres(docker.RunPostgresOptions{
			ContainerName:   containerName,
			VolumeName:      volumeName,
			HostPort:        hostPort,
			DB:              dbName,
			User:            username,
			Password:        password,
			PostgresVersion: fmt.Sprintf("%d", version),
		})
		if runErr != nil {
			if docker.IsPortAllocationError(runErr) {
				_ = d.Docker.RemoveVolume(volumeName)
				lastErr = runErr
				continue
			}
			_ = d.Docker.RemoveVolume(volumeName)
			return model.DeployResponse{}, runErr
		}

		if err := d.Docker.WaitReady(containerID, username, dbName, 90*time.Second); err != nil {
			_ = d.Docker.RemoveContainerForce(containerID)
			_ = d.Docker.RemoveVolume(volumeName)
			return model.DeployResponse{}, err
		}

		entry := model.DBInstance{
			Name:            name,
			ContainerID:     containerID,
			VolumeName:      volumeName,
			Host:            host,
			HostPort:        hostPort,
			DB:              dbName,
			User:            username,
			Password:        password,
			CreatedAt:       createdAt,
			PostgresVersion: fmt.Sprintf("%d", version),
			SizeGB:          req.SizeGB,
		}
		r.Items = append(r.Items, entry)
		if err := registry.Save(d.RegistryPath, r); err != nil {
			_ = d.Docker.RemoveContainerForce(containerID)
			_ = d.Docker.RemoveVolume(volumeName)
			return model.DeployResponse{}, err
		}

		return model.DeployResponse{
			Name:            entry.Name,
			Host:            entry.Host,
			Port:            entry.HostPort,
			DB:              entry.DB,
			User:            entry.User,
			Password:        entry.Password,
			DatabaseURL:     makeDatabaseURL(entry),
			CreatedAt:       entry.CreatedAt,
			PostgresVersion: entry.PostgresVersion,
		}, nil
	}

	if lastErr != nil {
		return model.DeployResponse{}, fmt.Errorf("failed to allocate host port after retries: %w", lastErr)
	}

	return model.DeployResponse{}, fmt.Errorf("deploy failed")
}

func normalizeOrGenerateName(raw string) (string, error) {
	if strings.TrimSpace(raw) == "" {
		suffix, err := util.RandomLowerAlphaNum(8)
		if err != nil {
			return "", err
		}
		return "db-" + suffix, nil
	}

	name := strings.ToLower(strings.TrimSpace(raw))
	if !deployNameRe.MatchString(name) {
		return "", fmt.Errorf("invalid name '%s' (must match %s)", raw, deployNameRe.String())
	}

	return name, nil
}

func reservePort() (int, error) {
	ln, err := net.Listen("tcp", "0.0.0.0:0")
	if err != nil {
		return 0, fmt.Errorf("reserve free port: %w", err)
	}
	defer func() { _ = ln.Close() }()

	addr, ok := ln.Addr().(*net.TCPAddr)
	if !ok {
		return 0, fmt.Errorf("unexpected listener address type: %T", ln.Addr())
	}
	return addr.Port, nil
}

func deriveHost(publicHost string, requestHost string) string {
	if strings.TrimSpace(publicHost) != "" {
		return publicHost
	}

	hostOnly := requestHost
	if strings.Contains(requestHost, ":") {
		h, _, err := net.SplitHostPort(requestHost)
		if err == nil {
			hostOnly = h
		}
	}

	hostOnly = strings.Trim(hostOnly, "[]")
	if hostOnly == "" {
		return "127.0.0.1"
	}
	return hostOnly
}

func makeDatabaseURL(item model.DBInstance) string {
	user := url.QueryEscape(item.User)
	pass := url.QueryEscape(item.Password)
	db := url.PathEscape(item.DB)
	return fmt.Sprintf("postgres://%s:%s@%s:%d/%s?sslmode=disable", user, pass, item.Host, item.HostPort, db)
}
