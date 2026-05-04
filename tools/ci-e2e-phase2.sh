#!/usr/bin/env bash
# Phase 2 HTTP e2e for CI: Postgres + lab HTTP venue + Nest services + npm run e2e:phase2-controlled-execution.
# Requires: npm ci && npm run build from repo root; DATABASE_URL pointing at Postgres (default localhost:5432).

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

export DATABASE_URL="${DATABASE_URL:-postgres://arbibot:arbibot@127.0.0.1:5432/arbibot}"
export RISK_SERVICE_URL="${RISK_SERVICE_URL:-http://127.0.0.1:3000}"

LAB_PORT="${LAB_VENUE_PORT:-3099}"
export LAB_VENUE_PORT="$LAB_PORT"

npm run db:migrate

node "$ROOT/tools/lab-venue-stand.mjs" &
LAB_PID=$!

PIDS=()
cleanup() {
  set +e
  kill "$LAB_PID" 2>/dev/null || true
  for pid in "${PIDS[@]:-}"; do
    kill "$pid" 2>/dev/null || true
  done
}
trap cleanup EXIT

for _ in $(seq 1 60); do
  if curl -sf "http://127.0.0.1:${LAB_PORT}/health" >/dev/null; then
    break
  fi
  sleep 0.5
done
if ! curl -sf "http://127.0.0.1:${LAB_PORT}/health" >/dev/null; then
  echo "lab-venue-stand did not become ready" >&2
  exit 1
fi

start_svc() {
  local name=$1
  local port=$2
  shift 2
  PORT="$port" DATABASE_URL="$DATABASE_URL" RISK_SERVICE_URL="$RISK_SERVICE_URL" \
    NODE_ENV="${NODE_ENV:-production}" \
    "$@" >>"/tmp/arbibot-e2e-${name}.log" 2>&1 &
  PIDS+=($!)
}

start_svc risk 3000 node "$ROOT/apps/risk-service/dist/main.js"
start_svc opportunity 3010 node "$ROOT/apps/opportunity-service/dist/main.js"
start_svc capital 3011 node "$ROOT/apps/capital-service/dist/main.js"
start_svc intake 3015 node "$ROOT/apps/market-intake-service/dist/main.js"

PORT=3012 DATABASE_URL="$DATABASE_URL" RISK_SERVICE_URL="$RISK_SERVICE_URL" \
  NODE_ENV="${NODE_ENV:-production}" \
  VENUE_HTTP_BASE_URL="http://127.0.0.1:${LAB_PORT}" \
  PRIVATE_KEY_ENCRYPTION_KEY="${PRIVATE_KEY_ENCRYPTION_KEY:-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa}" \
  node "$ROOT/apps/execution-orchestrator/dist/main.js" >>"/tmp/arbibot-e2e-execution.log" 2>&1 &
PIDS+=($!)

for port in 3000 3010 3011 3012 3015; do
  for _ in $(seq 1 120); do
    if curl -sf "http://127.0.0.1:${port}/metrics" >/dev/null; then
      break
    fi
    sleep 0.5
  done
  if ! curl -sf "http://127.0.0.1:${port}/metrics" >/dev/null; then
    echo "service on port ${port} did not expose /metrics in time" >&2
    for f in /tmp/arbibot-e2e-*.log; do
      echo "--- tail ${f} ---" >&2
      tail -n 40 "$f" >&2 || true
    done
    exit 1
  fi
done

npm run e2e:phase2-controlled-execution
