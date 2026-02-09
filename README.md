# pgdb

Small V0 platform to provision PostgreSQL databases with one command.

- `pgdb` is a Bun TypeScript CLI.
- `pgdbd` is a Go HTTP daemon that runs on a Linux server.
- Each deployment is one Docker Postgres container with its own persistent volume.
- `pgdb infra init` can provision a Hetzner server + volume + firewall for you.

## Repository tree

```text
pgdb/
  README.md
  .gitignore
  cli/
    package.json
    tsconfig.json
    bin/pgdb.ts
    src/config.ts
    src/http.ts
    src/infra.ts
    src/index.ts
    src/output.ts
    src/types.ts
  daemon/
    go.mod
    cmd/pgdbd/main.go
    internal/api/handlers.go
    internal/api/middleware.go
    internal/core/deploy.go
    internal/core/destroy.go
    internal/core/status.go
    internal/docker/client.go
    internal/model/types.go
    internal/registry/lock.go
    internal/registry/registry.go
    internal/util/random.go
    internal/util/time.go
  scripts/
    install.sh
    integration_test.sh
  systemd/
    pgdbd.service
```

## How it works

1. CLI sends authenticated HTTP requests (`Authorization: Bearer <PGDB_TOKEN>`) to `pgdbd`.
2. `pgdbd` creates one Postgres container per deploy, with one Docker volume per DB.
3. `pgdbd` stores deployment metadata in `/var/lib/pgdb/registry.json`.
4. Registry access is protected by a lock file (`/var/lib/pgdb/registry.lock`) to avoid races.

## API

- `POST /v1/deploy`
  - body: `{ "name"?, "size_gb"?, "version"? }`
  - returns: `{ name, host, port, db, user, password, database_url, created_at, postgres_version }`
- `GET /v1/status`
  - returns: `{ items: [...] }`
- `DELETE /v1/db/{name}?keep_data=true|false`
  - returns: `{ ok: true }`

## Free port strategy

V0 uses **bind to port 0** to ask the OS for a free port, then quickly releases and uses that port for Docker.

Tradeoff:
- Pro: simple and portable.
- Con: tiny race window where another process could claim the port.

Mitigation implemented:
- hold the registry lock during deploy;
- retry deployment on port-allocation errors.

## Local development

Requirements:
- Bun 1.1+
- Go 1.22+
- Docker

Run daemon locally:

```bash
export PGDB_TOKEN=dev-token
export PGDB_LISTEN=:8080
export PGDB_DATA_DIR=/tmp/pgdb
export PGDB_PUBLIC_HOST=127.0.0.1

go run ./daemon/cmd/pgdbd
```

Use CLI locally:

```bash
cd cli
bun install

export PGDB_TOKEN=dev-token
bun ./bin/pgdb.ts config set server.default http://127.0.0.1:8080
bun ./bin/pgdb.ts deploy
bun ./bin/pgdb.ts status
```

## Server install (Hetzner-friendly)

On Ubuntu server:

```bash
git clone <your-repo-url> pgdb
cd pgdb

export PGDB_TOKEN="$(openssl rand -hex 32)"
export PGDB_LISTEN=":8080"
export PGDB_PUBLIC_HOST="<server-public-ip-or-dns>"

sudo -E ./scripts/install.sh
```

Verify:

```bash
systemctl status pgdbd --no-pager
journalctl -u pgdbd -n 100 --no-pager
```

Firewall recommendations (Hetzner Cloud Firewall or host firewall):
- allow `22/tcp` from admin IPs only
- allow `8080/tcp` only from trusted CLI client IPs
- allow published Postgres ports only from trusted CIDRs (or use SSH tunnel)

## Configure CLI for a remote server

```bash
cd cli
bun install

export PGDB_TOKEN="<same token as server>"
bun ./bin/pgdb.ts config set server.default http://<server-ip>:8080
```

You can also install globally from `cli/`:

```bash
bun link
pgdb --help
```

## CLI commands

### Deploy

```bash
pgdb deploy [--name <string>] [--size <gb>] [--version <major>] [--server <alias>] [--json]
```

Human output example:

```text
name: mydb
host: 203.0.113.10
port: 32785
db: pg_3w7x9q2mzd
user: u_4p9ks2j8ra
password: 1LkQYt8f8uRa0PHX8nD_7T2Z7qg5i9W8vB3xkM4
DATABASE_URL: postgres://u_4p9ks2j8ra:1LkQYt8f8uRa0PHX8nD_7T2Z7qg5i9W8vB3xkM4@203.0.113.10:32785/pg_3w7x9q2mzd?sslmode=disable
```

JSON output example:

```bash
pgdb deploy --json
```

```json
{
  "name": "mydb",
  "host": "203.0.113.10",
  "port": 32785,
  "db": "pg_3w7x9q2mzd",
  "user": "u_4p9ks2j8ra",
  "password": "1LkQYt8f8uRa0PHX8nD_7T2Z7qg5i9W8vB3xkM4",
  "DATABASE_URL": "postgres://u_4p9ks2j8ra:...@203.0.113.10:32785/pg_3w7x9q2mzd?sslmode=disable"
}
```

### Status

```bash
pgdb status [--server <alias>] [--json]
```

### Destroy

```bash
pgdb destroy <name> [--keep-data] [--server <alias>] [--json]
```

- default removes container + volume + registry entry
- `--keep-data` removes container + registry entry, keeps volume

### Config

```bash
pgdb config set server.default <url>
```

Config path: `~/.config/pgdb/config.json`

### Infra init (Hetzner)

Creates a Hetzner VM, volume, and firewall, then writes `server.default` in your local pgdb config.

Required env var:
- `HCLOUD_TOKEN` (or `HETZNER_TOKEN`)

Example:

```bash
export HCLOUD_TOKEN=<hetzner-api-token>

pgdb infra init \
  --name pgdb-prod \
  --location nbg1 \
  --server-type cpx21 \
  --image ubuntu-24.04 \
  --volume-size 40 \
  --ssh-key-id 1234567 \
  --allow-cidr 203.0.113.0/24
```

What this command does:
- creates firewall (SSH + pgdbd API port)
- creates and attaches a persistent Hetzner volume
- creates server and waits for it to be running
- sets local CLI default server URL to `http://<server-ip>:8080`

What it does not do yet:
- nothing; pair with `infra bootstrap` below for one-command daemon installation.

### Infra bootstrap (Hetzner)

Bootstraps your new Hetzner machine over SSH by installing dependencies, cloning your repo, and running `scripts/install.sh` remotely.

```bash
pgdb infra bootstrap \
  --host 46.225.83.153 \
  --repo-url https://github.com/<you>/pgdb.git
```

Optional flags:
- `--user root` (default: `root`)
- `--path /opt/pgdb` (remote checkout path)
- `--public-host <ip-or-dns>` (default: `--host`)
- `--pgdb-port 8080` (default: `8080`)
- `--token <value>` (default: generated random token)

The command will:
- SSH into the server
- install `git` and `golang-go`
- clone/update your repo
- run `sudo -E ./scripts/install.sh`
- update local CLI default server URL
- print the token for local export

## Integration test

The integration test script deploys a DB, runs `SELECT 1`, and destroys it.

```bash
export PGDB_TOKEN=dev-token
export PGDB_SERVER_URL=http://127.0.0.1:8080

./scripts/integration_test.sh
```

## Registry format

`/var/lib/pgdb/registry.json` contains items with:

- `name`
- `container_id`
- `volume_name`
- `host_port`
- `db`
- `user`
- `created_at`
- `postgres_version`

Plus V0 convenience fields:
- `host`
- `password`
- `size_gb`

## Troubleshooting

- `401 unauthorized`
  - ensure `PGDB_TOKEN` matches on client and server.
- `docker not available`
  - run `docker ps` on server and check daemon logs.
- `postgres did not become ready`
  - inspect container logs: `docker logs <container_id>`.
- `database name already exists`
  - choose another `--name`.
- `connection refused`
  - check firewall rules and `PGDB_PUBLIC_HOST`.
- stale lock suspicion
  - lock uses kernel file locks; verify no stuck `pgdbd` process.

## Security notes (V0)

What is protected:
- API is protected by bearer token.
- No unauthenticated deploy/status/destroy.
- Registry updates are serialized via file lock.

What is not protected in V0:
- No per-user identity or RBAC.
- No built-in TLS termination in `pgdbd`.
- DB credentials are returned in plaintext API response.
- Postgres ports are network-exposed unless you firewall/tunnel.

Minimal hardening suggestions:
1. Put `pgdbd` behind TLS (Caddy/Nginx) and restrict source IPs.
2. Rotate `PGDB_TOKEN` regularly and store it securely.
3. Restrict published Postgres ports to trusted CIDRs.
4. Add backups for Docker volumes and `/var/lib/pgdb/registry.json`.
5. Run vulnerability and image update routine for `postgres:<version>`.
