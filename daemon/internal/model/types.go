package model

type Registry struct {
	Items []DBInstance `json:"items"`
}

type DBInstance struct {
	Name            string `json:"name"`
	ContainerID     string `json:"container_id"`
	VolumeName      string `json:"volume_name"`
	Host            string `json:"host"`
	HostPort        int    `json:"host_port"`
	DB              string `json:"db"`
	User            string `json:"user"`
	Password        string `json:"password"`
	CreatedAt       string `json:"created_at"`
	PostgresVersion string `json:"postgres_version"`
	SizeGB          int    `json:"size_gb,omitempty"`
}

type DeployRequest struct {
	Name    string `json:"name"`
	SizeGB  int    `json:"size_gb"`
	Version int    `json:"version"`
}

type DeployResponse struct {
	Name            string `json:"name"`
	Host            string `json:"host"`
	Port            int    `json:"port"`
	DB              string `json:"db"`
	User            string `json:"user"`
	Password        string `json:"password"`
	DatabaseURL     string `json:"database_url"`
	CreatedAt       string `json:"created_at"`
	PostgresVersion string `json:"postgres_version"`
}

type StatusResponse struct {
	Items []StatusItem `json:"items"`
}

type StatusItem struct {
	Name            string `json:"name"`
	ContainerID     string `json:"container_id"`
	VolumeName      string `json:"volume_name"`
	Host            string `json:"host"`
	HostPort        int    `json:"host_port"`
	DB              string `json:"db"`
	User            string `json:"user"`
	Password        string `json:"password"`
	CreatedAt       string `json:"created_at"`
	PostgresVersion string `json:"postgres_version"`
	DatabaseURL     string `json:"database_url"`
}
