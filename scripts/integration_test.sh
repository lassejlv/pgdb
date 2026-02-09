#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ -z "${PGDB_TOKEN:-}" ]]; then
  echo "PGDB_TOKEN is required"
  exit 1
fi

if [[ -z "${PGDB_SERVER_URL:-}" ]]; then
  echo "PGDB_SERVER_URL is required, e.g. http://127.0.0.1:8080"
  exit 1
fi

if ! command -v psql >/dev/null 2>&1; then
  echo "psql is required for integration test"
  exit 1
fi

pgdb() {
  bun "${ROOT_DIR}/cli/bin/pgdb.ts" "$@"
}

NAME="it-$(date +%s)"

cleanup() {
  set +e
  pgdb destroy "${NAME}" --json >/dev/null 2>&1
}
trap cleanup EXIT

echo "Configuring CLI..."
pgdb config set server.default "${PGDB_SERVER_URL}" >/dev/null

echo "Deploying ${NAME}..."
DEPLOY_JSON="$(pgdb deploy --name "${NAME}" --json)"

DATABASE_URL="$(printf '%s' "${DEPLOY_JSON}" | bun -e 'const text = await new Response(Bun.stdin.stream()).text(); const obj = JSON.parse(text); process.stdout.write(obj.DATABASE_URL ?? obj.database_url);')"

if [[ -z "${DATABASE_URL}" ]]; then
  echo "failed to parse DATABASE_URL from deploy output"
  exit 1
fi

echo "Running SELECT 1 through psql..."
QUERY_RESULT="$(psql "${DATABASE_URL}" -t -A -c "SELECT 1;")"

if [[ "${QUERY_RESULT}" != "1" ]]; then
  echo "unexpected query result: ${QUERY_RESULT}"
  exit 1
fi

echo "Destroying ${NAME}..."
pgdb destroy "${NAME}" --json >/dev/null

echo "Verifying it is gone..."
STATUS_JSON="$(pgdb status --json)"
EXISTS="$(printf '%s' "${STATUS_JSON}" | bun -e 'const text = await new Response(Bun.stdin.stream()).text(); const name = process.argv[2]; const obj = JSON.parse(text); const found = (obj.items || []).some((x) => x.name === name); process.stdout.write(found ? "yes" : "no");' "${NAME}")"

if [[ "${EXISTS}" == "yes" ]]; then
  echo "database still present after destroy"
  exit 1
fi

trap - EXIT
echo "Integration test passed."
