#!/usr/bin/env bash
# Scanner-service wiring smoke — regression guard (mirror of ci-hermes-agent-smoke.sh).
#
# WHY THIS EXISTS:
#   Scanner-service is a mode-agnostic data-provider with many moving parts (RPC layer, pool
#   reader, spread detector, publisher, retention + orphan workers, BFF, Hermes integration).
#   Each phase's DoD was a focused unit test, but nothing verified the WIRING end-to-end:
#   that the module wires all providers, the HTTP routes exist, the metrics registry is
#   populated, the BFF + Hermes gateway are plumbed. This smoke closes that gap with static
#   checks that run in CI without RPC secrets / running services.
#
# WHAT THIS SMOKE CHECKS (no running services / RPC keys needed — CI-friendly):
#   1. scanner-service builds cleanly (tsc -p tsconfig.build.json).
#   2. ScannerModule wires all expected providers (worker, pipeline, publisher, retention,
#      orphan, findings, controller).
#   3. Scanner controller declares the 8 HTTP routes from SCANNER_HTTP_ROUTES.
#   4. metrics registry: all arb_scanner_* metric names appear in the source.
#   5. BFF: 8 routes under apps/web/app/api/operator/scanners/ + scanner in api-base.ts.
#   6. Hermes gateway: scanner read-through endpoints + getScannerApiBase().
#   7. MCP: list_scanner_findings + get_scanner_status registered in tools/index.ts.
#   8. paper-live-boundary extended (PL.3/PL.4 scanner↔paper symmetry).
#
# WHAT THIS SMOKE DOES NOT CHECK (needs running services / RPC, out of CI scope):
#   - Real RPC reads (needs RPC_SCANNER_*_URL + mainnet connectivity)
#   - Real POST /opportunities round-trip (needs opportunity-service running)
#   - Real findings written to Postgres (needs migrated DB)
#   Those are covered by the manual runtime smoke in scanner-harness-runbook.md §3.
#
# Usage: bash tools/ci-scanner-smoke.sh
# Exit codes: 0 = ok, 1 = regression found.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

failures=0
fail() {
  printf '[FAIL] %s\n' "$1" >&2
  failures=$((failures + 1))
}
ok() { printf '[ok]   %s\n' "$1"; }

echo "── ci-scanner-smoke ──"
echo ""

# ── 1. scanner-service builds ──
if npm run build -w @arbibot/scanner-service >/dev/null 2>&1; then
  ok "scanner-service builds (tsc)"
else
  fail "scanner-service build failed"
fi

MODULE_FILE="apps/scanner-service/src/scanner/scanner.module.ts"
CTRL_FILE="apps/scanner-service/src/scanner/scanner.controller.ts"

# ── 2. ScannerModule wires the expected providers ──
declare -a EXPECTED_PROVIDERS=(
  "ScannerConfigService"
  "ScannerRpcService"
  "ScannerPoolService"
  "ScannerVolumeService"
  "ScannerSpreadService"
  "ScannerFilterService"
  "ScannerDedupService"
  "ScannerPipelineService"
  "ScannerPublisherService"
  "ScannerOrphanWorkerService"
  "ScannerRetentionWorkerService"
  "ScannerWorkerService"
  "ScannerFindingsService"
)
missing_providers=()
for p in "${EXPECTED_PROVIDERS[@]}"; do
  if ! grep -q "$p" "$MODULE_FILE"; then
    missing_providers+=("$p")
  fi
done
if (( ${#missing_providers[@]} == 0 )); then
  ok "ScannerModule wires all ${#EXPECTED_PROVIDERS[@]} expected providers"
else
  fail "ScannerModule missing providers: ${missing_providers[*]}"
fi

# ── 3. Controller declares the 8 HTTP routes ──
declare -a EXPECTED_ROUTES=(
  "@Get('instances')"
  "@Get('instances/:id')"
  "@Post('instances/:id/refresh-config')"
  "@Post('instances/:id/run')"
  "@Get('findings')"
  "@Get('findings/:id')"
  "@Post('findings/:id/re-publish')"
  "@Get('status')"
)
missing_routes=()
for r in "${EXPECTED_ROUTES[@]}"; do
  if ! grep -qF "$r" "$CTRL_FILE"; then
    missing_routes+=("$r")
  fi
done
if (( ${#missing_routes[@]} == 0 )); then
  ok "ScannerController declares all ${#EXPECTED_ROUTES[@]} HTTP routes"
else
  fail "ScannerController missing routes: ${missing_routes[*]}"
fi

# ── 4. Metrics registry: arb_scanner_* names appear in source ──
declare -a EXPECTED_METRICS=(
  "arb_scanner_cycles_total"
  "arb_scanner_spread_bps"
  "arb_scanner_volume_usd"
  "arb_scanner_rpc_latency_ms"
  "arb_scanner_rpc_rate_limited_total"
  "arb_scanner_opportunities_published_total"
  "arb_scanner_opportunity_publish_failed_total"
  "arb_scanner_orphan_republish_total"
  "arb_scanner_pool_cache_hit_ratio"
  "arb_scanner_volume_revert_total"
  "arb_scanner_findings_cleaned_total"
)
missing_metrics=()
for m in "${EXPECTED_METRICS[@]}"; do
  if ! grep -rq "$m" apps/scanner-service/src --include='*.ts' 2>/dev/null; then
    missing_metrics+=("$m")
  fi
done
if (( ${#missing_metrics[@]} == 0 )); then
  ok "All ${#EXPECTED_METRICS[@]} arb_scanner_* metrics present in source"
else
  fail "Missing metrics: ${missing_metrics[*]}"
fi

# ── 5. Web BFF: 8 routes + scanner in api-base ──
declare -a EXPECTED_BFF_ROUTES=(
  "apps/web/app/api/operator/scanners/instances/route.ts"
  "apps/web/app/api/operator/scanners/instances/[id]/route.ts"
  "apps/web/app/api/operator/scanners/instances/[id]/refresh-config/route.ts"
  "apps/web/app/api/operator/scanners/instances/[id]/run/route.ts"
  "apps/web/app/api/operator/scanners/findings/route.ts"
  "apps/web/app/api/operator/scanners/findings/[id]/route.ts"
  "apps/web/app/api/operator/scanners/findings/[id]/re-publish/route.ts"
  "apps/web/app/api/operator/scanners/status/route.ts"
)
missing_bff=()
for f in "${EXPECTED_BFF_ROUTES[@]}"; do
  if [[ ! -f "$f" ]]; then
    missing_bff+=("$f")
  fi
done
if (( ${#missing_bff[@]} == 0 )); then
  ok "Web BFF: all ${#EXPECTED_BFF_ROUTES[@]} /api/operator/scanners/* routes exist"
else
  fail "Web BFF missing routes: ${missing_bff[*]}"
fi
if grep -q "scanner:" apps/web/lib/api-base.ts; then
  ok "api-base.ts exports scanner base (SCANNER_API_BASE)"
else
  fail "api-base.ts missing scanner entry"
fi

# ── 6. Hermes gateway read-through + env helper ──
GW_CTRL="apps/hermes-gateway/src/hermes/hermes.controller.ts"
GW_ENV="apps/hermes-gateway/src/hermes/hermes-env.ts"
if grep -q "@Get('scanner/findings')" "$GW_CTRL" && \
   grep -q "@Get('scanner/findings/:id')" "$GW_CTRL" && \
   grep -q "@Get('scanner/status')" "$GW_CTRL"; then
  ok "Hermes gateway declares 3 scanner read-through endpoints"
else
  fail "Hermes gateway missing scanner read-through endpoints"
fi
if grep -q "getScannerApiBase" "$GW_ENV"; then
  ok "hermes-env.ts exports getScannerApiBase()"
else
  fail "hermes-env.ts missing getScannerApiBase()"
fi

# ── 7. MCP tools registered ──
MCP_INDEX="packages/hermes-mcp-server/src/tools/index.ts"
if grep -q "registerScannerTools" "$MCP_INDEX" && \
   grep -q "list_scanner_findings" packages/hermes-mcp-server/src/tools/scanner.ts && \
   grep -q "get_scanner_status" packages/hermes-mcp-server/src/tools/scanner.ts; then
  ok "MCP: list_scanner_findings + get_scanner_status registered"
else
  fail "MCP scanner tools not registered"
fi

# ── 8. paper-live-boundary extended with PL.3/PL.4 (scanner↔paper) ──
if grep -q "PL3-scanner-imports-paper" tools/ci-paper-live-boundary.sh && \
   grep -q "PL4-paper-imports-scanner" tools/ci-paper-live-boundary.sh; then
  ok "paper-live-boundary extended (PL.3/PL.4 scanner↔paper symmetry)"
else
  fail "paper-live-boundary missing PL.3/PL.4 scanner rules"
fi

echo ""
if (( failures > 0 )); then
  printf 'ci-scanner-smoke: FAIL — %d regression(s). Wiring gap — see scanner-harness-runbook.md.\n' "$failures" >&2
  exit 1
fi
echo "ci-scanner-smoke: ok (wiring intact; runtime round-trip needs manual smoke in scanner-harness-runbook.md §3)"
