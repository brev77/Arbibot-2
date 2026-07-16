#!/usr/bin/env bash
# Panic-recover — the deliberate reverse of panic-button.sh (D4-C-3-PANIC).
#
# Resuming trading after an emergency stop is NEVER a single-click operation. This
# script requires an explicit typed confirmation argument, clears the kill-switch
# flips, restarts the affected services, and writes an audit entry.
#
# Why typed-confirm and not two-person approval (D4-B-8-TWO-PERSON, descoped):
# the two-person rule was cancelled by product-owner decision for the current
# single-operator profile. The typed confirmation + audit trail is the accepted
# control. If two-person approval is reintroduced, panic-recover should route
# through it (see docs/adr-live-gate.md §L8 notes).
#
# Usage: bash tools/panic-recover.sh --confirm "I UNDERSTAND THIS RESUMES TRADING" [--reason "..."]
# Exit codes: 0 = recovery applied, 1 = cancelled / error.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

REQUIRED_CONFIRM="I UNDERSTAND THIS RESUMES TRADING"
CONFIRM=""
REASON=""
DRY_RUN=false

while (( $# > 0 )); do
  case "$1" in
    --confirm) CONFIRM="${2:-}"; shift 2 ;;
    --confirm=*) CONFIRM="${1#--confirm=}"; shift ;;
    --reason) REASON="${2:-}"; shift 2 ;;
    --reason=*) REASON="${1#--reason=}"; shift ;;
    --dry-run) DRY_RUN=true; shift ;;
    -h|--help)
      sed -n '2,20p' "$0" >&2
      exit 0 ;;
    *) echo "panic-recover: unknown arg '$1'" >&2; exit 1 ;;
  esac
done

if [[ "$CONFIRM" != "$REQUIRED_CONFIRM" ]]; then
  cat >&2 <<EOF
panic-recover: confirmation required.

Resuming trading after an emergency stop is a deliberate, audited action.
Re-run with:

  bash tools/panic-recover.sh --confirm "$REQUIRED_CONFIRM"

Optionally add --reason "..." for the audit trail.
EOF
  exit 1
fi

# flock optional (not available on all platforms, e.g. Windows Git Bash without
# util-linux). When absent, skip locking — concurrent recovery on those platforms
# is the operator's responsibility; on Linux servers flock is present.
have_flock() { command -v flock >/dev/null 2>&1; }

ENV_FILE="${PANIC_ENV_FILE:-.env}"
COMPOSE_FILE="${PANIC_COMPOSE_FILE:-infra/docker-compose.prod.yml}"
AUDIT_URL="${AUDIT_SERVICE_URL:-http://127.0.0.1:3013}"
LOCK_FILE="${PANIC_LOCK_FILE:-/tmp/arbibot-recover.lock}"
RESTART_SERVICES=(execution-orchestrator paper-trading-service risk-service)

now_iso() { date -u +"%Y-%m-%dT%H:%M:%SZ"; }
OPERATOR_ID="${PANIC_OPERATOR_ID:-$(id -un 2>/dev/null || echo unknown-operator)}"

echo "=== Arbibot panic-recover ===" >&2
echo "env file:    $ENV_FILE" >&2
echo "compose:     $COMPOSE_FILE" >&2
echo "operator:    $OPERATOR_ID" >&2
echo "reason:      ${REASON:-(none given)}" >&2
echo "dry-run:     $DRY_RUN" >&2
echo >&2

# flock against parallel recovery (skipped on platforms without flock, e.g. some
# Windows Git Bash installs; on Linux servers flock is present and enforced).
if have_flock; then
  exec 9>"$LOCK_FILE"
  if ! flock -n 9; then
    echo "panic-recover: another recovery is in progress ($LOCK_FILE held). Aborting." >&2
    exit 1
  fi
else
  echo "panic-recover: flock not available — concurrent-recovery protection skipped (operator beware)." >&2
fi

unflip_env() {
  local key="$1" value="$2"
  if [[ ! -f "$ENV_FILE" ]]; then
    echo "  $ENV_FILE not found — nothing to clear for $key" >&2
    return 0
  fi
  if $DRY_RUN; then
    echo "  [dry-run] would set $key=$value in $ENV_FILE" >&2
    return 0
  fi
  if grep -qE "^${key}=" "$ENV_FILE"; then
    local tmp; tmp="$(mktemp)"
    sed -E "s|^${key}=.*|${key}=${value}|" "$ENV_FILE" > "$tmp" && mv "$tmp" "$ENV_FILE"
    echo "  set $key=$value in $ENV_FILE" >&2
  else
    printf '%s=%s\n' "$key" "$value" >> "$ENV_FILE"
    echo "  appended $key=$value to $ENV_FILE" >&2
  fi
}

write_audit() {
  local action="$1" status="$2"
  local payload
  payload=$(cat <<JSON
{"actor":"$OPERATOR_ID","action":"$action","resourceType":"system","resourceId":"panic-button","payload":{"status":"$status","reason":${REASON:+\"$REASON\"}null,"envFile":"$ENV_FILE","dryRun":$($DRY_RUN && echo true || echo false)}}
JSON
)
  if $DRY_RUN; then
    echo "  [dry-run] would POST audit: $action / $status" >&2
    return 0
  fi
  if command -v curl >/dev/null 2>&1; then
    curl -fsS -m 5 -X POST "$AUDIT_URL/audit/entries" \
      -H 'Content-Type: application/json' -d "$payload" >/dev/null 2>&1 \
      && echo "  audit entry written ($action)" >&2 \
      || echo "  WARN: audit POST failed ($action) — recovery still applied" >&2
  else
    echo "  WARN: curl not available — audit skipped ($action). Recovery still applied." >&2
  fi
}

echo ">> Step 1/3: clearing kill-switches in $ENV_FILE" >&2
# Resume defaults: live unhalted, discovery on, policy jobs on.
unflip_env "DEX_LIVE_KILL_SWITCH" "false"
unflip_env "PAPER_DISCOVERY_ENABLED" "true"
unflip_env "RISK_POLICY_JOBS_ENABLED" "true"

echo ">> Step 2/3: restarting services to re-read env" >&2
if $DRY_RUN; then
  echo "  [dry-run] would run: docker compose -f $COMPOSE_FILE restart ${RESTART_SERVICES[*]}" >&2
else
  if command -v docker >/dev/null 2>&1; then
    if docker compose -f "$COMPOSE_FILE" restart "${RESTART_SERVICES[@]}" 2>&1 | sed 's/^/  /' >&2; then
      echo "  restarted: ${RESTART_SERVICES[*]}" >&2
    else
      echo "  WARN: docker compose restart failed — operator must restart manually" >&2
    fi
  else
    echo "  WARN: docker not available — operator must restart ${RESTART_SERVICES[*]} manually" >&2
  fi
fi

echo ">> Step 3/3: writing audit entry" >&2
write_audit "PANIC_BUTTON_RECOVERED" "recovered"

echo >&2
if $DRY_RUN; then
  echo "panic-recover: DRY RUN complete — no changes made." >&2
else
  echo "panic-recover: TRADING RESUMED." >&2
  echo "  Verify the kill-switches cleared: docker compose -f $COMPOSE_FILE logs execution-orchestrator | tail -20" >&2
fi
