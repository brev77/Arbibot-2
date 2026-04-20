#!/usr/bin/env bash
# Phase 2.2 policy writers e2e for CI: Postgres + risk-service + tools/e2e-phase2-watchlist-route-scoring.mjs
# Requires: npm ci && npm run build from repo root; DATABASE_URL pointing at Postgres (default localhost:5432 in CI).

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

export DATABASE_URL="${DATABASE_URL:-postgres://arbibot:arbibot@127.0.0.1:5432/arbibot}"
export RISK_SERVICE_URL="${RISK_SERVICE_URL:-http://127.0.0.1:3000}"
export RISK_POLICY_JOB_TRIGGER_TOKEN="${RISK_POLICY_JOB_TRIGGER_TOKEN:-ci-e2e-watchlist-route-scoring}"

npm run db:migrate

PIDS=()
cleanup() {
  set +e
  for pid in "${PIDS[@]:-}"; do
    kill "$pid" 2>/dev/null || true
  done
}
trap cleanup EXIT

PORT=3000 DATABASE_URL="$DATABASE_URL" NODE_ENV="${NODE_ENV:-production}" \
  RISK_POLICY_JOB_TRIGGER_TOKEN="$RISK_POLICY_JOB_TRIGGER_TOKEN" \
  node "$ROOT/apps/risk-service/dist/main.js" >>"/tmp/arbibot-e2e-phase2-watchlist-route-scoring-risk.log" 2>&1 &
PIDS+=($!)

for _ in $(seq 1 120); do
  if curl -sf "http://127.0.0.1:3000/metrics" >/dev/null; then
    break
  fi
  sleep 0.5
done
if ! curl -sf "http://127.0.0.1:3000/metrics" >/dev/null; then
  echo "risk-service on port 3000 did not expose /metrics in time" >&2
  if [[ -f /tmp/arbibot-e2e-phase2-watchlist-route-scoring-risk.log ]]; then
    echo "--- tail risk log ---" >&2
    tail -n 80 /tmp/arbibot-e2e-phase2-watchlist-route-scoring-risk.log >&2 || true
  fi
  exit 1
fi

npm run e2e:phase2-watchlist-route-scoring
