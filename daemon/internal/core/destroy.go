package core

import (
	"fmt"

	"pgdb/daemon/internal/docker"
	"pgdb/daemon/internal/registry"
)

type Destroyer struct {
	RegistryPath string
	LockPath     string
	Docker       *docker.Client
}

func (d *Destroyer) Destroy(name string, keepData bool) error {
	unlock, err := registry.AcquireLock(d.LockPath)
	if err != nil {
		return err
	}
	defer func() { _ = unlock() }()

	r, err := registry.Load(d.RegistryPath)
	if err != nil {
		return err
	}

	item, idx := registry.FindByName(r, name)
	if idx < 0 {
		return fmt.Errorf("database '%s' not found", name)
	}

	if err := d.Docker.RemoveContainerForce(item.ContainerID); err != nil {
		return err
	}

	if !keepData {
		if err := d.Docker.RemoveVolume(item.VolumeName); err != nil {
			return err
		}
	}

	r.Items = append(r.Items[:idx], r.Items[idx+1:]...)
	if err := registry.Save(d.RegistryPath, r); err != nil {
		return err
	}

	return nil
}
