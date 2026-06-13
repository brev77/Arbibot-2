#!/usr/bin/env bash
# Arbibot 2 — Production Environment Validator
#
# Validates .env file for deployment readiness:
#   - Checks all required variables are present
#   - Warns on placeholder/weak values
#   - Validates URL formats
#   - Checks secret strength
#
# Usage:
#   bash tools/validate-env.sh
#   ENV_FILE=infra/.env bash tools/validate-env.sh
#
# Exit codes:
#   0 — all checks passed
#   1 — critical issues found
#   2 — warnings only

set -euo pipefail

# ── Configuration ──────────────────────────────────────────────
ENV_FILE="${ENV_FILE:-.env}"
VERBOSE="${VERBOSE:-0}"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

PASS=0
FAIL=0
WARN=0
WARNINGS=()

# ── Helper functions ───────────────────────────────────────────
log_pass() {
  PASS=$((PASS + 1))
  echo -e "  ${GREEN}✓${NC} $1"
}

log_fail() {
  FAIL=$((FAIL + 1))
  echo -e "  ${RED}✗${NC} $1"
}

log_warn() {
  WARN=$((WARN + 1))
  WARNINGS+=("$1")
  echo -e "  ${YELLOW}⚠${NC} $1"
}

log_info() {
  echo -e "  ${BLUE}ℹ${NC} $1"
}

log_section() {
  echo ""
  echo "━━━ $1 ━━━"
}

# ── Load env file ──────────────────────────────────────────────
echo "╔══════════════════════════════════════════════════╗"
echo "║  Arbibot 2 — Environment Validator              ║"
echo "║  File: ${ENV_FILE}"
echo "╚══════════════════════════════════════════════════╝"

if [[ ! -f "${ENV_FILE}" ]]; then
  echo -e "${RED}ERROR: ${ENV_FILE} not found${NC}"
  echo "  Run: cp .env.production.example ${ENV_FILE}"
  exit 1
fi

# Parse env file (skip comments and empty lines; only VAR=value lines parsed)
declare -A ENV_VARS
while IFS= read -r line || [[ -n "$line" ]]; do
  # Strip trailing CR (Windows CRLF compatibility)
  line="${line%$'\r'}"
  # Skip blank lines and comments
  [[ -z "${line// /}" ]] && continue
  [[ "$line" =~ ^[[:space:]]*# ]] && continue
  # Match strict VAR=value (key must be a valid env identifier)
  if [[ "$line" =~ ^[[:space:]]*([A-Za-z_][A-Za-z0-9_]*)=(.*)$ ]]; then
    key="${BASH_REMATCH[1]}"
    value="${BASH_REMATCH[2]}"
    # Strip optional surrounding quotes (single or double)
    if [[ "${value:0:1}" == '"' && "${value: -1}" == '"' ]]; then
      value="${value:1:-1}"
    elif [[ "${value:0:1}" == "'" && "${value: -1}" == "'" ]]; then
      value="${value:1:-1}"
    fi
    ENV_VARS["$key"]="$value"
  fi
done < "${ENV_FILE}"

# ── 1. Required secrets ────────────────────────────────────────
log_section "Critical Secrets"

SECRET_VARS=(
  "POSTGRES_PASSWORD"
  "GRAFANA_ADMIN_PASSWORD"
  "RISK_POLICY_JOB_TRIGGER_TOKEN"
  "HERMES_API_KEYS"
  "HERMES_BFF_API_KEY"
)

for var in "${SECRET_VARS[@]}"; do
  val="${ENV_VARS[$var]:-}"
  if [[ -z "${val}" ]]; then
    log_fail "${var} — not set"
  elif [[ "${val}" == *"<CHANGE_ME"* ]]; then
    log_fail "${var} — still has placeholder value"
  elif [[ "${#val}" -lt 16 ]]; then
    log_warn "${var} — too short (${#val} chars, recommend 32+)"
  else
    log_pass "${var} — set (${#val} chars)"
  fi
done

# ── 2. Database configuration ──────────────────────────────────
log_section "Database"

if [[ -n "${ENV_VARS[DATABASE_URL]:-}" ]]; then
  log_pass "DATABASE_URL — set"
  # Check if using PgBouncer
  if [[ "${ENV_VARS[DATABASE_URL]}" == *"pgbouncer"* ]]; then
    log_pass "DATABASE_URL — routes through PgBouncer"
  else
    log_warn "DATABASE_URL — not using PgBouncer (direct connection)"
  fi
else
  log_fail "DATABASE_URL — not set"
fi

if [[ -n "${ENV_VARS[POSTGRES_USER]:-}" ]]; then
  log_pass "POSTGRES_USER — ${ENV_VARS[POSTGRES_USER]}"
else
  log_fail "POSTGRES_USER — not set"
fi

if [[ -n "${ENV_VARS[POSTGRES_DB]:-}" ]]; then
  log_pass "POSTGRES_DB — ${ENV_VARS[POSTGRES_DB]}"
else
  log_fail "POSTGRES_DB — not set"
fi

# ── 3. Infrastructure services ─────────────────────────────────
log_section "Infrastructure URLs"

INFRA_VARS=(
  "REDIS_URL"
  "KAFKA_BROKERS"
  "CORS_ORIGINS"
)

for var in "${INFRA_VARS[@]}"; do
  val="${ENV_VARS[$var]:-}"
  if [[ -n "${val}" ]]; then
    log_pass "${var} — ${val}"
  else
    log_warn "${var} — not set (using default may be OK for docker compose)"
  fi
done

# ── 4. Inter-service URLs ──────────────────────────────────────
log_section "Inter-service URLs"

SERVICE_URLS=(
  "RISK_API_BASE"
  "CONFIG_API_BASE"
  "OPPORTUNITY_API_BASE"
  "CAPITAL_API_BASE"
  "EXECUTION_API_BASE"
  "AUDIT_API_BASE"
  "PORTFOLIO_API_BASE"
  "RECONCILIATION_API_BASE"
  "PAPER_API_BASE"
  "MARKET_INTAKE_API_BASE"
)

SET_COUNT=0
for var in "${SERVICE_URLS[@]}"; do
  val="${ENV_VARS[$var]:-}"
  if [[ -n "${val}" ]]; then
    SET_COUNT=$((SET_COUNT + 1))
    if [[ "${VERBOSE}" == "1" ]]; then
      log_pass "${var} — ${val}"
    fi
  fi
done

if [[ ${SET_COUNT} -eq ${#SERVICE_URLS[@]} ]]; then
  log_pass "All ${#SERVICE_URLS[@]} service URLs configured"
elif [[ ${SET_COUNT} -gt 0 ]]; then
  log_warn "${SET_COUNT}/${#SERVICE_URLS[@]} service URLs configured (defaults used for rest)"
else
  log_warn "No service URLs configured (using docker compose defaults)"
fi

# ── 5. Feature flags ───────────────────────────────────────────
log_section "Feature Flags"

# DEX should be disabled for paper trading deploy
if [[ "${ENV_VARS[DEX_LIVE_ENABLED]:-false}" == "false" ]]; then
  log_pass "DEX_LIVE_ENABLED=false — correct for paper trading"
else
  log_warn "DEX_LIVE_ENABLED=true — DEX is LIVE, ensure this is intentional"
fi

if [[ "${ENV_VARS[DEX_LIVE_KILL_SWITCH]:-true}" == "true" ]]; then
  log_pass "DEX_LIVE_KILL_SWITCH=true — safety enabled"
else
  log_warn "DEX_LIVE_KILL_SWITCH=false — kill switch disabled"
fi

if [[ "${ENV_VARS[PAPER_DISCOVERY_ENABLED]:-true}" == "true" ]]; then
  log_pass "PAPER_DISCOVERY_ENABLED=true — paper discovery active"
else
  log_info "PAPER_DISCOVERY_ENABLED=false — paper discovery disabled"
fi

if [[ "${ENV_VARS[INTAKE_THROTTLING_ENABLED]:-true}" == "true" ]]; then
  log_pass "INTAKE_THROTTLING_ENABLED=true — throttling active"
else
  log_info "INTAKE_THROTTLING_ENABLED=false — throttling disabled"
fi

# ── 6. Observability ───────────────────────────────────────────
log_section "Observability"

OBS_VARS=(
  "METRICS_ENABLED"
  "AUDIT_CLIENT_ENABLED"
)

for var in "${OBS_VARS[@]}"; do
  val="${ENV_VARS[$var]:-}"
  if [[ "${val}" == "true" ]]; then
    log_pass "${var} — enabled"
  else
    log_warn "${var} — not enabled (should be 'true' in production)"
  fi
done

# ── 7. Security checks ─────────────────────────────────────────
log_section "Security"

# Check for placeholder values
PLACEHOLDER_COUNT=0
for key in "${!ENV_VARS[@]}"; do
  if [[ "${ENV_VARS[$key]}" == *"<CHANGE_ME"* ]]; then
    PLACEHOLDER_COUNT=$((PLACEHOLDER_COUNT + 1))
    if [[ "${VERBOSE}" == "1" ]]; then
      log_fail "${key} — contains placeholder"
    fi
  fi
done

if [[ ${PLACEHOLDER_COUNT} -eq 0 ]]; then
  log_pass "No placeholder values found"
else
  log_fail "${PLACEHOLDER_COUNT} variables still have <CHANGE_ME> placeholders"
fi

# Check for ARBIBOT_DEV_ROLE in production env (F4: bypasses RBAC)
if [[ -n "${ENV_VARS[ARBIBOT_DEV_ROLE]:-}" ]]; then
  log_fail "ARBIBOT_DEV_ROLE is set — env-fallback bypasses RBAC (see F4 in docs/pre-deploy-review.md). Remove from production .env."
fi

# Check CORS origins
CORS="${ENV_VARS[CORS_ORIGINS]:-}"
if [[ "${CORS}" == *"*"* ]]; then
  log_fail "CORS_ORIGINS='*' — wildcard CORS is insecure for production"
elif [[ "${CORS}" == *"localhost"* ]]; then
  log_warn "CORS_ORIGINS includes localhost — remove for production"
elif [[ -n "${CORS}" ]]; then
  log_pass "CORS_ORIGINS — specific origins set"
else
  log_warn "CORS_ORIGINS — not set (defaults may not be safe for production)"
fi

# ── 8. Optional but recommended ────────────────────────────────
log_section "Optional (Recommended)"

OPT_VARS=(
  "HERMES_GATEWAY_URL"
  "PAPER_TRADING_SERVICE_URL"
)

for var in "${OPT_VARS[@]}"; do
  val="${ENV_VARS[$var]:-}"
  if [[ -n "${val}" ]]; then
    log_pass "${var} — set"
  else
    log_info "${var} — not set (uses default)"
  fi
done

# ── Summary ────────────────────────────────────────────────────
echo ""
echo "╔══════════════════════════════════════════════════╗"
echo "║  Validation Summary                              ║"
echo "╠══════════════════════════════════════════════════╣"
echo -e "║  ${GREEN}PASS${NC}: ${PASS}                                        "
echo -e "║  ${RED}FAIL${NC}: ${FAIL}                                        "
echo -e "║  ${YELLOW}WARN${NC}: ${WARN}                                        "
echo "╚══════════════════════════════════════════════════╝"

if [[ ${#WARNINGS[@]} -gt 0 ]]; then
  echo ""
  echo "Warnings:"
  for w in "${WARNINGS[@]}"; do
    echo -e "  ${YELLOW}•${NC} ${w}"
  done
fi

if [[ ${FAIL} -gt 0 ]]; then
  echo ""
  echo -e "${RED}ENV VALIDATION FAILED — fix critical issues before deploying${NC}"
  exit 1
elif [[ ${WARN} -gt 0 ]]; then
  echo ""
  echo -e "${YELLOW}Validation passed with warnings${NC}"
  exit 2
else
  echo ""
  echo -e "${GREEN}Environment is ready for deployment${NC}"
  exit 0
fi