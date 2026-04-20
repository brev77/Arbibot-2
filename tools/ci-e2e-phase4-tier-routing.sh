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
cleanup() {
  set +e
  for pid in "${PIDS[@]:-}"; do
    kill "$pid" 2>/dev/null || true
  done
}
trap cleanup EXIT

# risk-service :3000
PORT=3000 DATABASE_URL="$DATABASE_URL" NODE_ENV="${NODE_ENV:-production}" \
  node "$ROOT/apps/risk-service/dist/main.js" >>"/tmp/arbibot-e2e-phase4-risk.log" 2>&1 &
PIDS+=($!)

# config-service :3019 — disable audit HTTP so seed/create is not blocked in CI
PORT=3019 DATABASE_URL="$DATABASE_URL" NODE_ENV="${NODE_ENV:-production}" \
  AUDIT_CLIENT_ENABLED=false \
  node "$ROOT/apps/config-service/dist/main.js" >>"/tmp/arbibot-e2e-phase4-config.log" 2>&1 &
PIDS+=($!)

for _ in $(seq 1 120); do
  if curl -sf "http://127.0.0.1:3000/metrics" >/dev/null && curl -sf "http://127.0.0.1:3019/metrics" >/dev/null; then
    break
  fi
  sleep 0.5
done
if ! curl -sf "http://127.0.0.1:3000/metrics" >/dev/null; then
  echo "risk-service /metrics not ready" >&2
  tail -n 80 /tmp/arbibot-e2e-phase4-risk.log >&2 || true
  exit 1
fi
if ! curl -sf "http://127.0.0.1:3019/metrics" >/dev/null; then
  echo "config-service /metrics not ready" >&2
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
  if curl -sf "http://127.0.0.1:3015/metrics" >/dev/null; then
    break
  fi
  sleep 0.5
done
if ! curl -sf "http://127.0.0.1:3015/metrics" >/dev/null; then
  echo "market-intake /metrics not ready" >&2
  tail -n 80 /tmp/arbibot-e2e-phase4-intake.log >&2 || true
  exit 1
fi

npm run e2e:phase4-tier-routing
