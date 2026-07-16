#!/usr/bin/env bash
# Panic-button — atomic emergency stop for Arbibot 2 trading (D4-C-3-PANIC, threat P6).
#
# Flips every real backend-enforced kill-switch in one action, restarts the affected
# services so they re-read the env, and writes an audit entry. The reverse
# (panic-recover.sh) requires an explicit typed confirmation — resuming trading is
# never a single-click operation.
#
# Kill-switches flipped (each is actually READ by backend code — verified):
#   DEX_LIVE_KILL_SWITCH=true      → execution-orchestrator DexKillSwitchService (fail-closed)
#   PAPER_DISCOVERY_ENABLED=false  → paper-trading-service PaperDiscoveryService
#   RISK_POLICY_JOBS_ENABLED=false → risk-service PolicyJobsService
#
# NOTE on PAPER_DEX_MAINNET_ENABLED: documented in docs/incident-response-playbook.md §4
# and .env.example, but NO service reads it today (dead flag, see D4-C-3-PANIC research).
# We do NOT flip it here — faking protection that does not exist would be worse than
# honesty. It is tracked as a TODO in docs/incident-response-playbook.md.
#
# Where the env is written:
#   - Default: appends the flips to .env (read by docker-compose on next `up`).
#   - With PANIC_ENV_FILE=/path/to/.env.prod: writes there instead.
#   - With --dry-run: prints the plan, changes nothing.
#
# Usage: bash tools/panic-button.sh [--dry-run] [--reason "SEV-1: ..."]
# Exit codes: 0 = panic applied (or dry-run ok), 1 = error.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

DRY_RUN=false
REASON=""
while (( $# > 0 )); do
  case "$1" in
    --dry-run) DRY_RUN=true; shift ;;
    --reason) REASON="${2:-}"; shift 2 ;;
    --reason=*) REASON="${1#--reason=}"; shift ;;
    -h|--help)
      sed -n '2,30p' "$0" >&2
      exit 0 ;;
    *) echo "panic-button: unknown arg '$1'" >&2; exit 1 ;;
  esac
done

ENV_FILE="${PANIC_ENV_FILE:-.env}"
COMPOSE_FILE="${PANIC_COMPOSE_FILE:-infra/docker-compose.prod.yml}"
AUDIT_URL="${AUDIT_SERVICE_URL:-http://127.0.0.1:3013}"
LOCK_FILE="${PANIC_LOCK_FILE:-/tmp/arbibot-panic.lock}"

# Services that must re-read env to pick up the kill-switch flips.
RESTART_SERVICES=(execution-orchestrator paper-trading-service risk-service)

now_iso() { date -u +"%Y-%m-%dT%H:%M:%SZ"; }
OPERATOR_ID="${PANIC_OPERATOR_ID:-$(id -un 2>/dev/null || echo unknown-operator)}"

echo "=== Arbibot panic-button ===" >&2
echo "env file:    $ENV_FILE" >&2
echo "compose:     $COMPOSE_FILE" >&2
echo "operator:    $OPERATOR_ID" >&2
echo "reason:      ${REASON:-(none given)}" >&2
echo "dry-run:     $DRY_RUN" >&2
echo >&2

# ---- flock: protect against two operators panicking in parallel ----------------
# flock is optional (not present on all platforms, e.g. some Windows Git Bash).
# When absent, skip locking — operator beware; on Linux servers flock is enforced.
have_flock() { command -v flock >/dev/null 2>&1; }

acquire_lock() {
  if ! have_flock; then
    echo "panic-button: flock not available — concurrent-panic protection skipped (operator beware)." >&2
    return 0
  fi
  exec 9>"$LOCK_FILE"
  if ! flock -n 9; then
    echo "panic-button: another panic is in progress ($LOCK_FILE held). Aborting." >&2
    echo "If stale, remove the lock file: rm $LOCK_FILE" >&2
    exit 1
  fi
}

# ---- flip an env key in the target file (idempotent) --------------------------
# flip_env <key> <value>
flip_env() {
  local key="$1" value="$2" file="$ENV_FILE"
  if [[ ! -f "$file" ]]; then
    echo "# panic-button $(now_iso)" > "$file"
  fi
  if grep -qE "^${key}=" "$file"; then
    # Replace existing assignment.
    if $DRY_RUN; then
      echo "  [dry-run] would update $key=... → $key=$value in $file" >&2
    else
      # Use a temp file + mv for atomicity on POSIX filesystems.
      local tmp; tmp="$(mktemp)"
      sed -E "s|^${key}=.*|${key}=${value}|" "$file" > "$tmp" && mv "$tmp" "$file"
      echo "  updated $key=$value in $file" >&2
    fi
  else
    if $DRY_RUN; then
      echo "  [dry-run] would append $key=$value to $file" >&2
    else
      printf '%s=%s\n' "$key" "$value" >> "$file"
      echo "  appended $key=$value to $file" >&2
    fi
  fi
}

# ---- audit entry --------------------------------------------------------------
write_audit() {
  local action="$1" status="$2"
  local payload
  payload=$(cat <<JSON
{"actor":"$OPERATOR_ID","action":"$action","resourceType":"system","resourceId":"panic-button","payload":{"status":"$status","reason":${REASON:+\"$REASON\"}null,"envFile":"$ENV_FILE","dryRun":$($DRY_RUN && echo true || echo false)}}
JSON
)
  # Best-effort: audit must not block the panic. Failure is logged, not fatal.
  if $DRY_RUN; then
    echo "  [dry-run] would POST audit: $action / $status" >&2
    return 0
  fi
  if command -v curl >/dev/null 2>&1; then
    curl -fsS -m 5 -X POST "$AUDIT_URL/audit/entries" \
      -H 'Content-Type: application/json' -d "$payload" >/dev/null 2>&1 \
      && echo "  audit entry written ($action)" >&2 \
      || echo "  WARN: audit POST failed ($action) — panic still applied" >&2
  else
    echo "  WARN: curl not available — audit skipped ($action). Panic still applied." >&2
  fi
}

# ---- main ---------------------------------------------------------------------

echo ">> Step 1/3: acquiring lock" >&2
if ! $DRY_RUN; then
  acquire_lock
fi

echo ">> Step 2/3: flipping kill-switches in $ENV_FILE" >&2
flip_env "DEX_LIVE_KILL_SWITCH" "true"
flip_env "PAPER_DISCOVERY_ENABLED" "false"
flip_env "RISK_POLICY_JOBS_ENABLED" "false"
echo "  (PAPER_DEX_MAINNET_ENABLED NOT flipped — documented but not read by any service; see playbook §4 TODO)" >&2

echo ">> Step 3/3: restarting services to re-read env" >&2
if $DRY_RUN; then
  echo "  [dry-run] would run: docker compose -f $COMPOSE_FILE restart ${RESTART_SERVICES[*]}" >&2
else
  if command -v docker >/dev/null 2>&1; then
    # Restart only the affected services (data layer, web, gateway untouched).
    if docker compose -f "$COMPOSE_FILE" restart "${RESTART_SERVICES[@]}" 2>&1 | sed 's/^/  /' >&2; then
      echo "  restarted: ${RESTART_SERVICES[*]}" >&2
    else
      echo "  WARN: docker compose restart failed — services may need manual restart to pick up kill-switches" >&2
    fi
  else
    echo "  WARN: docker not available — operator must restart ${RESTART_SERVICES[*]} manually" >&2
  fi
fi

echo ">> Writing audit entry" >&2
write_audit "PANIC_BUTTON_TRIGGERED" "applied"

echo >&2
if $DRY_RUN; then
  echo "panic-button: DRY RUN complete — no changes made." >&2
else
  echo "panic-button: PANIC APPLIED. Trading is halted." >&2
  echo "  To resume: bash tools/panic-recover.sh --confirm \"I UNDERSTAND THIS RESUMES TRADING\"" >&2
fi
