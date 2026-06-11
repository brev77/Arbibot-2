#!/usr/bin/env bash
# Phase 4 intake tier-routing + throttle e2e: Postgres + risk + config + market-intake + tools/e2e-phase4-tier-routing.mjs
# Requires: npm ci && npm run build from repo root.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

export DATABASE_URL="${DATABASE_URL:-postgres://arbibot:arbibot@127.0.0.1:5432/arbibot}"
export RISK_SERVICE_URL="${RISK_SERVICE_URL:-http://127.0.0.1:3000}"
export CONFIG_API_BASE="${CONFIG_API_BASE:-http://127.0.0.1:3019}"
export MARKET_INTAKE_SERVICE_URL="${MARKET_INTAKE_SERVICE_URL:-http://127.0.0.1:3015}"
export INTAKE_THROTTLING_ENABLED="${INTAKE_THROTTLING_ENABLED:-true}"

npm run db:migrate

PIDS=()
LOG_FILES=()

dump_logs() {
  echo "=== Dumping server logs on failure ===" >&2
  for f in "${LOG_FILES[@]}"; do
    if [ -f "$f" ]; then
      echo "--- tail $(basename "$f") ---" >&2
      tail -n 100 "$f" >&2 || true
    fi
  done
  cleanup
}

cleanup() {
  set +e
  for pid in "${PIDS[@]:-}"; do
    kill "$pid" 2>/dev/null || true
  done
}
trap dump_logs EXIT

# risk-service :3000
PORT=3000 DATABASE_URL="$DATABASE_URL" NODE_ENV="${NODE_ENV:-production}" \
  AUDIT_CLIENT_ENABLED=false \
  node "$ROOT/apps/risk-service/dist/main.js" >>"/tmp/arbibot-e2e-phase4-risk.log" 2>&1 &
PIDS+=($!)

# config-service :3019 — disable audit HTTP so seed/create is not blocked in CI
PORT=3019 DATABASE_URL="$DATABASE_URL" NODE_ENV="${NODE_ENV:-production}" \
  AUDIT_CLIENT_ENABLED=false \
  node "$ROOT/apps/config-service/dist/main.js" >>"/tmp/arbibot-e2e-phase4-config.log" 2>&1 &
PIDS+=($!)

LOG_FILES=(
  /tmp/arbibot-e2e-phase4-risk.log
  /tmp/arbibot-e2e-phase4-config.log
  /tmp/arbibot-e2e-phase4-intake.log
)

for _ in $(seq 1 120); do
  if (curl -sf "http://127.0.0.1:3000/health" >/dev/null 2>&1 || curl -sf "http://127.0.0.1:3000/metrics" >/dev/null 2>&1) && \
     (curl -sf "http://127.0.0.1:3019/health" >/dev/null 2>&1 || curl -sf "http://127.0.0.1:3019/metrics" >/dev/null 2>&1); then
    break
  fi
  sleep 0.5
done
if ! curl -sf "http://127.0.0.1:3000/health" >/dev/null 2>&1 && \
   ! curl -sf "http://127.0.0.1:3000/metrics" >/dev/null 2>&1; then
  echo "risk-service /health or /metrics not ready" >&2
  tail -n 80 /tmp/arbibot-e2e-phase4-risk.log >&2 || true
  exit 1
fi
if ! curl -sf "http://127.0.0.1:3019/health" >/dev/null 2>&1 && \
   ! curl -sf "http://127.0.0.1:3019/metrics" >/dev/null 2>&1; then
  echo "config-service /health or /metrics not ready" >&2
  tail -n 80 /tmp/arbibot-e2e-phase4-config.log >&2 || true
  exit 1
fi

CONFIG_API_BASE="$CONFIG_API_BASE" node "$ROOT/tools/seed-intake-policy-config.mjs"

# market-intake :3015
PORT=3015 DATABASE_URL="$DATABASE_URL" NODE_ENV="${NODE_ENV:-production}" \
  RISK_SERVICE_URL="$RISK_SERVICE_URL" \
  CONFIG_API_BASE="$CONFIG_API_BASE" \
  INTAKE_THROTTLING_ENABLED=true \
  INTAKE_POLICY_CACHE_TTL_MS=5000 \
  node "$ROOT/apps/market-intake-service/dist/main.js" >>"/tmp/arbibot-e2e-phase4-intake.log" 2>&1 &
PIDS+=($!)

for _ in $(seq 1 120); do
  if curl -sf "http://127.0.0.1:3015/health" >/dev/null 2>&1 || \
     curl -sf "http://127.0.0.1:3015/metrics" >/dev/null 2>&1; then
    break
  fi
  sleep 0.5
done
if ! curl -sf "http://127.0.0.1:3015/health" >/dev/null 2>&1 && \
   ! curl -sf "http://127.0.0.1:3015/metrics" >/dev/null 2>&1; then
  echo "market-intake /health or /metrics not ready" >&2
  tail -n 80 /tmp/arbibot-e2e-phase4-intake.log >&2 || true
  exit 1
fi

npm run e2e:phase4-tier-routing
