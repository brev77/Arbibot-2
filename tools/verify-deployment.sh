#!/usr/bin/env bash
# Arbibot 2 — Deployment Verification Script
#
# Verifies that all services are healthy after a deployment.
# Run after: docker compose -f infra/docker-compose.prod.yml up -d
#
# Usage:
#   bash tools/verify-deployment.sh
#   BASE_URL=https://operator.example.com bash tools/verify-deployment.sh
#   SKIP_SERVICES="redpanda,promtail" bash tools/verify-deployment.sh
#   VERIFY_MODE=isolated bash tools/verify-deployment.sh  # prod: only nginx + docker exec
#
# VERIFY_MODE:
#   direct     (default) — curl backend services on published ports (dev/local)
#   isolated   (prod)    — skip direct backend port checks; use nginx /health + docker exec
#
# Exit codes:
#   0 — all checks passed
#   1 — one or more critical checks failed
#   2 — all checks passed but with warnings

set -euo pipefail

# ── Configuration ──────────────────────────────────────────────
BASE_URL="${BASE_URL:-http://localhost}"
SKIP_SERVICES="${SKIP_SERVICES:-}"
TIMEOUT="${CURL_TIMEOUT:-10}"
VERBOSE="${VERBOSE:-0}"
VERIFY_MODE="${VERIFY_MODE:-direct}"  # direct (default) | isolated (prod)

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

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

should_skip() {
  local svc="$1"
  if [[ -n "${SKIP_SERVICES}" ]]; then
    IFS=',' read -ra SKIP <<< "${SKIP_SERVICES}"
    for s in "${SKIP[@]}"; do
      if [[ "${s}" == "${svc}" ]]; then
        return 0
      fi
    done
  fi
  return 1
}

check_http() {
  local name="$1"
  local url="$2"
  local expected_status="${3:-200}"
  
  if should_skip "${name}"; then
    log_warn "Skipping ${name} (in SKIP_SERVICES)"
    return
  fi

  if [[ "${VERBOSE}" == "1" ]]; then
    echo "  Checking: ${url}"
  fi

  local status
  status=$(curl -sk -o /dev/null -w "%{http_code}" --max-time "${TIMEOUT}" "${url}" 2>/dev/null || echo "000")
  
  if [[ "${status}" == "${expected_status}" ]]; then
    log_pass "${name} — HTTP ${status}"
  elif [[ "${status}" == "000" ]]; then
    log_fail "${name} — connection refused / timeout"
  else
    log_fail "${name} — expected HTTP ${expected_status}, got ${status}"
  fi
}

check_docker_container() {
  local name="$1"
  
  if should_skip "${name}"; then
    return
  fi

  local state
  state=$(docker compose -f infra/docker-compose.prod.yml ps --format json 2>/dev/null \
    | grep -o "\"${name}\"" > /dev/null 2>&1 && echo "running" || echo "unknown")
  
  # More reliable check using docker ps
  if docker ps --filter "name=${name}" --format '{{.Status}}' | grep -qi "up" 2>/dev/null; then
    log_pass "${name} — container running"
  else
    log_fail "${name} — container not running"
  fi
}

# ── Pre-flight ─────────────────────────────────────────────────
echo "╔══════════════════════════════════════════════════╗"
echo "║  Arbibot 2 — Deployment Verification            ║"
echo "║  Target: ${BASE_URL}"
echo "╚══════════════════════════════════════════════════╝"

# ── 1. Docker containers ──────────────────────────────────────
log_section "Docker Containers"

CONTAINERS=(
  "postgres"
  "redis"
  "redpanda"
  "risk-service"
  "opportunity-service"
  "capital-service"
  "execution-orchestrator"
  "audit-service"
  "canonical-market-service"
  "market-intake-service"
  "portfolio-service"
  "reconciliation-service"
  "paper-trading-service"
  "config-service"
  "hermes-gateway"
  "web"
  "nginx"
  "prometheus"
  "grafana"
  "loki"
  "pgbouncer"
  "alertmanager"
)

for container in "${CONTAINERS[@]}"; do
  check_docker_container "${container}"
done

# ── 2. HTTP health checks ────────────────────────────────────
log_section "HTTP Health Checks"

# nginx / TLS termination (always reachable, published port in isolated mode)
check_http "nginx-HTTP" "${BASE_URL}/health" 200

if [[ "${VERIFY_MODE}" == "isolated" ]]; then
  log_warn "VERIFY_MODE=isolated — skipping direct backend port checks (prod network isolation)"
  log_info "Use 'docker exec <svc> curl -sf localhost:<port>/metrics' for in-network verification"
else
  # Direct backend port checks (dev/local where ports are published)
  check_http "risk-service" "${BASE_URL}:3000/metrics" 200 || true
  check_http "config-service" "${BASE_URL}:3019/metrics" 200 || true
  check_http "opportunity-service" "${BASE_URL}:3010/metrics" 200 || true
  check_http "execution-orchestrator" "${BASE_URL}:3012/metrics" 200 || true
  check_http "paper-trading-service" "${BASE_URL}:3018/metrics" 200 || true
  check_http "hermes-gateway" "${BASE_URL}:3020/health" 200 || true
  check_http "canonical-market-service" "${BASE_URL}:3014/metrics" 200 || true
  check_http "market-intake-service" "${BASE_URL}:3015/metrics" 200 || true
  check_http "portfolio-service" "${BASE_URL}:3016/metrics" 200 || true
  check_http "reconciliation-service" "${BASE_URL}:3017/metrics" 200 || true
  check_http "audit-service" "${BASE_URL}:3013/metrics" 200 || true
fi

# Web dashboard health (always checked — nginx-routed)
check_http "web-health" "${BASE_URL}/api/health" 200 || true

# ── 3. Database connectivity ─────────────────────────────────
log_section "Database"

if command -v psql &>/dev/null || command -v docker &>/dev/null; then
  # Check if we can reach PostgreSQL through PgBouncer
  DB_CHECK=$(docker exec "$(docker ps -q -f name=pgbouncer 2>/dev/null | head -1)" \
    psql "postgres://arbibot:${POSTGRES_PASSWORD:-arbibot}@postgres:5432/arbibot" \
    -tAc "SELECT count(*) FROM schema_migrations;" 2>/dev/null || echo "FAIL")
  
  if [[ "${DB_CHECK}" != "FAIL" && "${DB_CHECK}" -gt 0 ]]; then
    log_pass "PostgreSQL — ${DB_CHECK} migrations applied"
  else
    log_warn "PostgreSQL — cannot verify migrations (non-critical if containers are healthy)"
  fi
else
  log_warn "PostgreSQL — psql/docker not available for migration check"
fi

# ── 4. Redis connectivity ────────────────────────────────────
log_section "Redis"

REDIS_CHECK=$(docker exec "$(docker ps -q -f name=redis 2>/dev/null | head -1)" \
  redis-cli ping 2>/dev/null || echo "FAIL")

if [[ "${REDIS_CHECK}" == "PONG" ]]; then
  log_pass "Redis — PONG"
else
  log_warn "Redis — cannot verify (non-critical if containers are healthy)"
fi

# ── 5. Kafka / Redpanda ──────────────────────────────────────
log_section "Event Bus"

if docker ps --format '{{.Names}}' | grep -q redpanda 2>/dev/null; then
  TOPICS=$(docker exec "$(docker ps -q -f name=redpanda 2>/dev/null | head -1)" \
    rpk topic list 2>/dev/null || echo "FAIL")
  
  if [[ "${TOPICS}" != "FAIL" ]]; then
    log_pass "Redpanda — reachable"
    if echo "${TOPICS}" | grep -q "arbibot"; then
      log_pass "Redpanda — arbibot topics exist"
    else
      log_warn "Redpanda — no arbibot topics yet (normal on first deploy)"
    fi
  else
    log_warn "Redpanda — cannot verify topics"
  fi
else
  log_warn "Redpanda — container not found"
fi

# ── 6. Observability ─────────────────────────────────────────
log_section "Observability"

check_http "Prometheus" "${BASE_URL}:9090/-/healthy" 200 || true
check_http "Grafana" "${BASE_URL}:3000/api/health" 200 || true
check_http "Alertmanager" "${BASE_URL}:9093/-/healthy" 200 || true

# ── 7. HTTPS / TLS ──────────────────────────────────────────
log_section "TLS / Security"

HTTPS_URL="${BASE_URL/http:\/\//https:\/\/}"
if curl -sk -o /dev/null -w "%{http_code}" --max-time "${TIMEOUT}" "${HTTPS_URL}" 2>/dev/null | grep -q "200\|301"; then
  log_pass "HTTPS — accessible"
else
  log_warn "HTTPS — not accessible (self-signed cert may not match BASE_URL)"
fi

# Check security headers
SEC_HEADERS=$(curl -skI "${HTTPS_URL}" --max-time "${TIMEOUT}" 2>/dev/null || echo "")
if echo "${SEC_HEADERS}" | grep -qi "x-content-type-options"; then
  log_pass "Security headers — present"
else
  log_warn "Security headers — not detected"
fi

# ── 8. Canonical registry ───────────────────────────────────
log_section "Application Data"

# Check if canonical registry is seeded
# In isolated mode, use web BFF route; in direct mode, hit canonical-market-service directly
if [[ "${VERIFY_MODE}" == "isolated" ]]; then
  SEED_URL="${BASE_URL}/api/operator/canonical/instruments"
else
  SEED_URL="${BASE_URL}:3014/canonical/instruments"
fi
SEED_CHECK=$(curl -sk --max-time "${TIMEOUT}" "${SEED_URL}" 2>/dev/null || echo "")
if [[ -n "${SEED_CHECK}" && "${SEED_CHECK}" != "" ]]; then
  log_pass "Canonical registry — seeded"
else
  log_warn "Canonical registry — may need seeding (npm run db:seed-canonical)"
fi

# ── Summary ───────────────────────────────────────────────────
echo ""
echo "╔══════════════════════════════════════════════════╗"
echo "║  Verification Summary                            ║"
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
  echo -e "${RED}DEPLOYMENT HAS FAILURES — investigate before proceeding${NC}"
  exit 1
elif [[ ${WARN} -gt 0 ]]; then
  echo ""
  echo -e "${YELLOW}Deployment OK with warnings${NC}"
  exit 2
else
  echo ""
  echo -e "${GREEN}All checks passed — deployment is healthy${NC}"
  exit 0
fi