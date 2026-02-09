#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run as root (or with sudo)."
  exit 1
fi

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TOKEN="${PGDB_TOKEN:-}"
LISTEN="${PGDB_LISTEN:-:8080}"
PUBLIC_HOST="${PGDB_PUBLIC_HOST:-}"

if [[ -z "${TOKEN}" ]]; then
  echo "PGDB_TOKEN must be set. Example: PGDB_TOKEN=$(openssl rand -hex 32) sudo ./scripts/install.sh"
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "Installing docker.io..."
  apt-get update
  DEBIAN_FRONTEND=noninteractive apt-get install -y docker.io
fi

if ! command -v go >/dev/null 2>&1; then
  echo "Go is required to build pgdbd. Install Go 1.22+ and rerun."
  exit 1
fi

echo "Building pgdbd..."
(cd "${ROOT_DIR}/daemon" && go build -o /usr/local/bin/pgdbd ./cmd/pgdbd)
chmod +x /usr/local/bin/pgdbd

echo "Preparing directories..."
mkdir -p /var/lib/pgdb
chmod 755 /var/lib/pgdb

echo "Writing /etc/pgdbd.env..."
cat >/etc/pgdbd.env <<EOF
PGDB_TOKEN=${TOKEN}
PGDB_LISTEN=${LISTEN}
PGDB_DATA_DIR=/var/lib/pgdb
PGDB_PUBLIC_HOST=${PUBLIC_HOST}
EOF
chmod 600 /etc/pgdbd.env

echo "Installing systemd unit..."
install -m 644 "${ROOT_DIR}/systemd/pgdbd.service" /etc/systemd/system/pgdbd.service

echo "Enabling and starting service..."
systemctl daemon-reload
systemctl enable --now pgdbd

echo
echo "Install complete."
echo "Check status with: systemctl status pgdbd --no-pager"
echo "Follow logs with: journalctl -u pgdbd -f"
