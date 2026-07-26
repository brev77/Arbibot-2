#!/usr/bin/env bash
# PAD-8 CI: Postgres + paper-trading-service (AutoDriveWorker enabled) + tools/e2e-paper-auto-drive.mjs
# Requires: npm ci && npm run build from repo root; DATABASE_URL pointing at Postgres.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

export DATABASE_URL="${DATABASE_URL:-postgres://arbibot:arbibot@127.0.0.1:5432/arbibot}"
export PAPER_API_BASE="${PAPER_API_BASE:-http://127.0.0.1:3018}"
# AutoDrive config — short intervals so the e2e completes in seconds.
export PAPER_AUTO_DRIVE_ENABLED="${PAPER_AUTO_DRIVE_ENABLED:-true}"
export PAPER_AUTO_DRIVE_INTERVAL_MS="${PAPER_AUTO_DRIVE_INTERVAL_MS:-1000}"
export PAPER_AUTO_APPROVE="${PAPER_AUTO_APPROVE:-true}"
export PAPER_AUTO_SETTLE_DELAY_MS="${PAPER_AUTO_SETTLE_DELAY_MS:-1000}"
export PAPER_AUTO_DRIVE_MIN_NET_PROFIT_USD="${PAPER_AUTO_DRIVE_MIN_NET_PROFIT_USD:-1}"
export PAPER_NOTIONAL_USD="${PAPER_NOTIONAL_USD:-1000}"
export PAPER_AUTO_DRIVE_BATCH_SIZE="${PAPER_AUTO_DRIVE_BATCH_SIZE:-10}"

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
  PAPER_AUTO_DRIVE_ENABLED="$PAPER_AUTO_DRIVE_ENABLED" \
  PAPER_AUTO_DRIVE_INTERVAL_MS="$PAPER_AUTO_DRIVE_INTERVAL_MS" \
  PAPER_AUTO_APPROVE="$PAPER_AUTO_APPROVE" \
  PAPER_AUTO_SETTLE_DELAY_MS="$PAPER_AUTO_SETTLE_DELAY_MS" \
  PAPER_AUTO_DRIVE_MIN_NET_PROFIT_USD="$PAPER_AUTO_DRIVE_MIN_NET_PROFIT_USD" \
  PAPER_NOTIONAL_USD="$PAPER_NOTIONAL_USD" \
  PAPER_AUTO_DRIVE_BATCH_SIZE="$PAPER_AUTO_DRIVE_BATCH_SIZE" \
  node "$ROOT/apps/paper-trading-service/dist/main.js" >>"/tmp/arbibot-e2e-paper-auto-drive.log" 2>&1 &
PIDS+=($!)
LOG_FILES+=(/tmp/arbibot-e2e-paper-auto-drive.log)

for _ in $(seq 1 120); do
  if curl -sf "http://127.0.0.1:3018/health" >/dev/null 2>&1 || \
     curl -sf "http://127.0.0.1:3018/metrics" >/dev/null 2>&1; then
    break
  fi
  sleep 0.5
done
if ! curl -sf "http://127.0.0.1:3018/health" >/dev/null 2>&1 && \
   ! curl -sf "http://127.0.0.1:3018/metrics" >/dev/null 2>&1; then
  echo "paper-trading-service on port 3018 did not expose /health or /metrics in time" >&2
  tail -n 80 /tmp/arbibot-e2e-paper-auto-drive.log >&2 || true
  exit 1
fi

node "$ROOT/tools/e2e-paper-auto-drive.mjs"
