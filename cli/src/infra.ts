import { loadConfig, saveConfig } from "./config";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";

type InitInfraOptions = {
  name?: string;
  location?: string;
  serverType?: string;
  image?: string;
  volumeSize?: number;
  sshKeyId?: number;
  pgdbPort?: number;
  allowCidr?: string;
  json?: boolean;
};

type BootstrapInfraOptions = {
  host: string;
  user?: string;
  repoUrl: string;
  path?: string;
  pgdbPort?: number;
  publicHost?: string;
  token?: string;
};

type HcloudServer = {
  id: number;
  name: string;
  public_net?: {
    ipv4?: { ip: string };
  };
  status: string;
};

type InitInfraResult = {
  provider: "hetzner";
  server: {
    id: number;
    name: string;
    ipv4: string;
    status: string;
  };
  volume: {
    id: number;
    name: string;
    size_gb: number;
  };
  firewall: {
    id: number;
    name: string;
  };
  daemon_url: string;
  next_steps: string[];
};

type BootstrapInfraResult = {
  host: string;
  user: string;
  daemon_url: string;
  token: string;
  service_status: "installed";
  next_steps: string[];
};

const HCLOUD_API = "https://api.hetzner.cloud/v1";

export async function initHetznerInfra(opts: InitInfraOptions): Promise<InitInfraResult> {
  const token = process.env.HCLOUD_TOKEN || process.env.HETZNER_TOKEN;
  if (!token) {
    throw new Error("HCLOUD_TOKEN (or HETZNER_TOKEN) is required to create Hetzner infrastructure");
  }

  const name = opts.name || `pgdb-${Date.now().toString(36)}`;
  const location = opts.location || "nbg1";
  const serverType = opts.serverType || "cpx21";
  const image = opts.image || "ubuntu-24.04";
  const volumeSize = opts.volumeSize ?? 20;
  const pgdbPort = opts.pgdbPort ?? 8080;
  const allowCidr = opts.allowCidr || "0.0.0.0/0";

  if (!opts.sshKeyId || opts.sshKeyId <= 0) {
    throw new Error("--ssh-key-id is required (use an existing Hetzner SSH key id)");
  }

  const firewall = await hcloudRequest<{ firewall: { id: number; name: string } }>(token, {
    method: "POST",
    path: "/firewalls",
    body: {
      name: `${name}-fw`,
      rules: [
        {
          direction: "in",
          protocol: "tcp",
          port: "22",
          source_ips: [allowCidr],
          description: "SSH"
        },
        {
          direction: "in",
          protocol: "tcp",
          port: String(pgdbPort),
          source_ips: [allowCidr],
          description: "pgdbd API"
        }
      ]
    }
  });

  const volumeResp = await hcloudRequest<{
    volume: { id: number; name: string; size: number };
  }>(token, {
    method: "POST",
    path: "/volumes",
    body: {
      name: `${name}-data`,
      size: volumeSize,
      location,
      format: "ext4",
      automount: true
    }
  });

  const serverResp = await hcloudRequest<{
    server: HcloudServer;
  }>(token, {
    method: "POST",
    path: "/servers",
    body: {
      name,
      server_type: serverType,
      image,
      location,
      ssh_keys: [opts.sshKeyId],
      firewalls: [{ firewall: firewall.firewall.id }],
      volumes: [volumeResp.volume.id],
      user_data: cloudInit(pgdbPort)
    }
  });

  const ready = await waitForServerRunning(token, serverResp.server.id, 180_000);
  const ip = ready.public_net?.ipv4?.ip;
  if (!ip) {
    throw new Error("Hetzner server was created but no public IPv4 was assigned");
  }

  const daemonURL = `http://${ip}:${pgdbPort}`;

  const cfg = await loadConfig();
  cfg.servers.default = daemonURL;
  cfg.defaultServer = "default";
  await saveConfig(cfg);

  return {
    provider: "hetzner",
    server: {
      id: ready.id,
      name: ready.name,
      ipv4: ip,
      status: ready.status
    },
    volume: {
      id: volumeResp.volume.id,
      name: volumeResp.volume.name,
      size_gb: volumeResp.volume.size
    },
    firewall: {
      id: firewall.firewall.id,
      name: firewall.firewall.name
    },
    daemon_url: daemonURL,
    next_steps: [
      `ssh root@${ip}`,
      "Set a strong token on the server: export PGDB_TOKEN=$(openssl rand -hex 32)",
      `Set daemon host/port: export PGDB_PUBLIC_HOST=${ip} && export PGDB_LISTEN=:${pgdbPort}`,
      "Clone this repository on the server and run: sudo -E ./scripts/install.sh",
      `On your local machine set the same token: export PGDB_TOKEN=<same-token>`,
      "Then run: pgdb deploy"
    ]
  };
}

export async function bootstrapHetznerInfra(opts: BootstrapInfraOptions): Promise<BootstrapInfraResult> {
  if (!opts.host) {
    throw new Error("--host is required");
  }
  if (!opts.repoUrl) {
    throw new Error("--repo-url is required");
  }

  const user = opts.user || "root";
  const path = opts.path || "/opt/pgdb";
  const pgdbPort = opts.pgdbPort ?? 8080;
  const publicHost = opts.publicHost || opts.host;
  const token = opts.token || randomBytes(32).toString("hex");

  const remoteScript = makeBootstrapScript({
    repoUrl: opts.repoUrl,
    path,
    token,
    publicHost,
    pgdbPort
  });

  await runSSHScript(`${user}@${opts.host}`, remoteScript);

  const daemonURL = `http://${publicHost}:${pgdbPort}`;
  const cfg = await loadConfig();
  cfg.servers.default = daemonURL;
  cfg.defaultServer = "default";
  await saveConfig(cfg);

  return {
    host: opts.host,
    user,
    daemon_url: daemonURL,
    token,
    service_status: "installed",
    next_steps: [
      `export PGDB_TOKEN=${token}`,
      `pgdb config set server.default ${daemonURL}`,
      "pgdb deploy"
    ]
  };
}

export function printInfraBootstrap(result: BootstrapInfraResult, asJson: boolean): void {
  if (asJson) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(`host: ${result.host}`);
  console.log(`user: ${result.user}`);
  console.log(`service_status: ${result.service_status}`);
  console.log(`daemon_url: ${result.daemon_url}`);
  console.log(`token: ${result.token}`);
  console.log("next_steps:");
  for (const step of result.next_steps) {
    console.log(`  - ${step}`);
  }
}

export function printInfraInit(result: InitInfraResult, asJson: boolean): void {
  if (asJson) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(`provider: ${result.provider}`);
  console.log(`server: ${result.server.name} (id=${result.server.id}, ip=${result.server.ipv4})`);
  console.log(`volume: ${result.volume.name} (id=${result.volume.id}, size_gb=${result.volume.size_gb})`);
  console.log(`firewall: ${result.firewall.name} (id=${result.firewall.id})`);
  console.log(`daemon_url: ${result.daemon_url}`);
  console.log("next_steps:");
  for (const step of result.next_steps) {
    console.log(`  - ${step}`);
  }
}

async function waitForServerRunning(token: string, serverID: number, timeoutMs: number): Promise<HcloudServer> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const data = await hcloudRequest<{ server: HcloudServer }>(token, {
      method: "GET",
      path: `/servers/${serverID}`
    });

    if (data.server.status === "running") {
      return data.server;
    }
    await Bun.sleep(2000);
  }

  throw new Error("Timed out waiting for Hetzner server to reach running state");
}

async function hcloudRequest<T>(
  token: string,
  opts: { method: "GET" | "POST" | "DELETE"; path: string; body?: unknown }
): Promise<T> {
  const url = `${HCLOUD_API}${opts.path}`;
  const res = await fetch(url, {
    method: opts.method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body)
  });

  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) {
    throw new Error(`Hetzner API ${opts.method} ${opts.path} failed (${res.status}): ${text}`);
  }
  return data as T;
}

function cloudInit(pgdbPort: number): string {
  return `#cloud-config
package_update: true
packages:
  - docker.io
runcmd:
  - systemctl enable docker
  - systemctl start docker
  - mkdir -p /var/lib/pgdb
  - chmod 755 /var/lib/pgdb
  - ufw --force enable
  - ufw allow 22/tcp
  - ufw allow ${pgdbPort}/tcp
`;
}

function makeBootstrapScript(opts: {
  repoUrl: string;
  path: string;
  token: string;
  publicHost: string;
  pgdbPort: number;
}): string {
  return `#!/usr/bin/env bash
set -euo pipefail

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y git golang-go

if [ -d "${opts.path}/.git" ]; then
  git -C "${opts.path}" fetch --all --prune
  git -C "${opts.path}" pull --ff-only
else
  rm -rf "${opts.path}"
  git clone "${opts.repoUrl}" "${opts.path}"
fi

cd "${opts.path}"
export PGDB_TOKEN='${opts.token}'
export PGDB_PUBLIC_HOST='${opts.publicHost}'
export PGDB_LISTEN=':${opts.pgdbPort}'

sudo -E ./scripts/install.sh
systemctl is-active --quiet pgdbd
`;
}

async function runSSHScript(target: string, script: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn("ssh", [target, "bash -s"], {
      stdio: ["pipe", "inherit", "inherit"]
    });

    child.stdin.write(script);
    child.stdin.end();

    child.on("error", (err) => {
      reject(new Error(`failed to execute ssh: ${String(err)}`));
    });

    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`remote bootstrap failed with exit code ${code}`));
    });
  });
}
