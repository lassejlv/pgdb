package docker

import (
	"bytes"
	"errors"
	"fmt"
	"os/exec"
	"strconv"
	"strings"
	"time"
)

type Client struct{}

func NewClient() *Client {
	return &Client{}
}

func (c *Client) EnsureAvailable() error {
	cmd := exec.Command("docker", "version", "--format", "{{.Server.Version}}")
	if out, err := cmd.CombinedOutput(); err != nil {
		return fmt.Errorf("docker not available: %w: %s", err, strings.TrimSpace(string(out)))
	}
	return nil
}

func (c *Client) CreateVolume(name string) error {
	cmd := exec.Command("docker", "volume", "create", name)
	if out, err := cmd.CombinedOutput(); err != nil {
		return fmt.Errorf("create volume %s: %w: %s", name, err, strings.TrimSpace(string(out)))
	}
	return nil
}

func (c *Client) RemoveVolume(name string) error {
	cmd := exec.Command("docker", "volume", "rm", name)
	if out, err := cmd.CombinedOutput(); err != nil {
		return fmt.Errorf("remove volume %s: %w: %s", name, err, strings.TrimSpace(string(out)))
	}
	return nil
}

func (c *Client) RunPostgres(opts RunPostgresOptions) (string, error) {
	args := []string{
		"run", "-d",
		"--name", opts.ContainerName,
		"--restart", "unless-stopped",
		"-e", "POSTGRES_DB=" + opts.DB,
		"-e", "POSTGRES_USER=" + opts.User,
		"-e", "POSTGRES_PASSWORD=" + opts.Password,
		"-v", opts.VolumeName + ":/var/lib/postgresql/data",
		"-p", strconv.Itoa(opts.HostPort) + ":5432",
		"postgres:" + opts.PostgresVersion,
	}

	cmd := exec.Command("docker", args...)
	out, err := cmd.CombinedOutput()
	if err != nil {
		return "", fmt.Errorf("docker run failed: %w: %s", err, strings.TrimSpace(string(out)))
	}

	containerID := strings.TrimSpace(string(out))
	if containerID == "" {
		return "", errors.New("docker run returned empty container id")
	}

	return containerID, nil
}

type RunPostgresOptions struct {
	ContainerName   string
	VolumeName      string
	HostPort        int
	DB              string
	User            string
	Password        string
	PostgresVersion string
}

func (c *Client) RemoveContainerForce(containerID string) error {
	cmd := exec.Command("docker", "rm", "-f", containerID)
	out, err := cmd.CombinedOutput()
	if err != nil {
		text := strings.TrimSpace(string(out))
		if strings.Contains(text, "No such container") {
			return nil
		}
		return fmt.Errorf("remove container %s: %w: %s", containerID, err, text)
	}
	return nil
}

func (c *Client) WaitReady(containerID, user, db string, timeout time.Duration) error {
	deadline := time.Now().Add(timeout)
	for {
		if time.Now().After(deadline) {
			return fmt.Errorf("postgres did not become ready before %s", timeout)
		}

		cmd := exec.Command("docker", "exec", containerID, "pg_isready", "-U", user, "-d", db)
		if err := cmd.Run(); err == nil {
			return nil
		}

		time.Sleep(1 * time.Second)
	}
}

func IsPortAllocationError(err error) bool {
	if err == nil {
		return false
	}
	msg := err.Error()
	return strings.Contains(msg, "port is already allocated") || strings.Contains(msg, "address already in use")
}

func (c *Client) ExecSQL(containerID, user, db, sql string) (string, error) {
	cmd := exec.Command("docker", "exec", containerID, "psql", "-U", user, "-d", db, "-t", "-A", "-c", sql)
	var stdout bytes.Buffer
	var stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		return "", fmt.Errorf("exec sql: %w: %s", err, strings.TrimSpace(stderr.String()))
	}
	return strings.TrimSpace(stdout.String()), nil
}
