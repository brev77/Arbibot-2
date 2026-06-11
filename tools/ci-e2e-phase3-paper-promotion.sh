#!/usr/bin/env bash
# Phase 3 e2e for CI: Postgres + paper-trading-service + opportunity-service + npm run e2e:phase3-paper-promotion.
# Requires: npm ci && npm run build from repo root; DATABASE_URL pointing at Postgres (default localhost:5432).

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

export DATABASE_URL="${DATABASE_URL:-postgres://arbibot:arbibot@127.0.0.1:5432/arbibot}"
export PAPER_TRADING_SERVICE_URL="${PAPER_TRADING_SERVICE_URL:-http://127.0.0.1:3018}"
export OUTBOX_RELAY_POLL_MS="${OUTBOX_RELAY_POLL_MS:-400}"
export PAPER_DISCOVERY_POLL_MS="${PAPER_DISCOVERY_POLL_MS:-0}"
export PAPER_DISCOVERY_RUN_TOKEN="${PAPER_DISCOVERY_RUN_TOKEN:-ci-paper-discovery}"

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

PORT=3018 DATABASE_URL="$DATABASE_URL" NODE_ENV="${NODE_ENV:-production}" \
  AUDIT_CLIENT_ENABLED=false \
  node "$ROOT/apps/paper-trading-service/dist/main.js" >>"/tmp/arbibot-e2e-phase3-paper.log" 2>&1 &
PIDS+=($!)

PORT=3010 DATABASE_URL="$DATABASE_URL" NODE_ENV="${NODE_ENV:-production}" \
  AUDIT_CLIENT_ENABLED=false \
  PAPER_TRADING_SERVICE_URL="$PAPER_TRADING_SERVICE_URL" \
  OUTBOX_RELAY_POLL_MS="$OUTBOX_RELAY_POLL_MS" \
  PAPER_DISCOVERY_POLL_MS="$PAPER_DISCOVERY_POLL_MS" \
  PAPER_DISCOVERY_RUN_TOKEN="$PAPER_DISCOVERY_RUN_TOKEN" \
  node "$ROOT/apps/opportunity-service/dist/main.js" >>"/tmp/arbibot-e2e-phase3-opportunity.log" 2>&1 &
PIDS+=($!)

LOG_FILES=(
  /tmp/arbibot-e2e-phase3-paper.log
  /tmp/arbibot-e2e-phase3-opportunity.log
)

for port in 3018 3010; do
  for _ in $(seq 1 120); do
    if curl -sf "http://127.0.0.1:${port}/health" >/dev/null 2>&1 || \
       curl -sf "http://127.0.0.1:${port}/metrics" >/dev/null 2>&1; then
      break
    fi
    sleep 0.5
  done
  if ! curl -sf "http://127.0.0.1:${port}/health" >/dev/null 2>&1 && \
     ! curl -sf "http://127.0.0.1:${port}/metrics" >/dev/null 2>&1; then
    echo "service on port ${port} did not expose /health or /metrics in time" >&2
    for f in /tmp/arbibot-e2e-phase3-*.log; do
      echo "--- tail ${f} ---" >&2
      tail -n 60 "$f" >&2 || true
    done
    exit 1
  fi
done

export OPPORTUNITY_SERVICE_URL="${OPPORTUNITY_SERVICE_URL:-http://127.0.0.1:3010}"
export PAPER_TRADING_SERVICE_URL="${PAPER_TRADING_SERVICE_URL:-http://127.0.0.1:3018}"

npm run e2e:phase3-paper-promotion
