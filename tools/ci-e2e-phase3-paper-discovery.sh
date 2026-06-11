#!/usr/bin/env bash
# Phase 3 e2e for CI: Postgres + paper-trading-service + market-intake-service + tools/e2e-p3-paper-discovery.mjs
# Requires: npm ci && npm run build from repo root; DATABASE_URL pointing at Postgres (default localhost:5432 in CI).

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

export DATABASE_URL="${DATABASE_URL:-postgres://arbibot:arbibot@127.0.0.1:5432/arbibot}"
export MARKET_INTAKE_SERVICE_URL="${MARKET_INTAKE_SERVICE_URL:-http://127.0.0.1:3015}"
export PAPER_API_BASE="${PAPER_API_BASE:-http://127.0.0.1:3018}"
export PAPER_DISCOVERY_ENABLED="${PAPER_DISCOVERY_ENABLED:-true}"
export PAPER_DISCOVERY_INTERVAL_MS="${PAPER_DISCOVERY_INTERVAL_MS:-30000}"
export PAPER_DISCOVERY_MIN_PROFIT_USD="${PAPER_DISCOVERY_MIN_PROFIT_USD:-0.5}"
export PAPER_DISCOVERY_MIN_LIQUIDITY_SCORE="${PAPER_DISCOVERY_MIN_LIQUIDITY_SCORE:-0.1}"
export PAPER_DISCOVERY_MAX_CANDIDATES_PER_RUN="${PAPER_DISCOVERY_MAX_CANDIDATES_PER_RUN:-10}"
export PAPER_DISCOVERY_PAPER_ONLY_TOKENS="${PAPER_DISCOVERY_PAPER_ONLY_TOKENS:-BTC,ETH}"
export PAPER_DISCOVERY_PAPER_ONLY_ROUTES="${PAPER_DISCOVERY_PAPER_ONLY_ROUTES:-btc-eth-uniswap,eth-usdc-curve}"

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
  node "$ROOT/apps/paper-trading-service/dist/main.js" >>"/tmp/arbibot-e2e-phase3-paper-discovery-paper.log" 2>&1 &
PIDS+=($!)

PORT=3015 DATABASE_URL="$DATABASE_URL" NODE_ENV="${NODE_ENV:-production}" \
  AUDIT_CLIENT_ENABLED=false \
  node "$ROOT/apps/market-intake-service/dist/main.js" >>"/tmp/arbibot-e2e-phase3-paper-discovery-intake.log" 2>&1 &
PIDS+=($!)

LOG_FILES=(
  /tmp/arbibot-e2e-phase3-paper-discovery-paper.log
  /tmp/arbibot-e2e-phase3-paper-discovery-intake.log
)

for port in 3018 3015; do
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
    for f in /tmp/arbibot-e2e-phase3-paper-discovery-*.log; do
      echo "--- tail ${f} ---" >&2
      tail -n 60 "$f" >&2 || true
    done
    exit 1
  fi
done

node "$ROOT/tools/e2e-p3-paper-discovery.mjs"
