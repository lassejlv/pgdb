export type DeployRequest = {
  name?: string;
  size_gb?: number;
  version?: number;
};

export type DeployResponse = {
  name: string;
  host: string;
  port: number;
  db: string;
  user: string;
  password: string;
  database_url: string;
  created_at: string;
  postgres_version: string;
};

export type StatusItem = {
  name: string;
  container_id: string;
  volume_name: string;
  host: string;
  host_port: number;
  db: string;
  user: string;
  password: string;
  created_at: string;
  postgres_version: string;
  database_url: string;
};

export type StatusResponse = {
  items: StatusItem[];
};

export type DestroyResponse = {
  ok: true;
};

export type PgdbConfig = {
  defaultServer: string;
  servers: Record<string, string>;
};
