#!/usr/bin/env bash
# Hermes Agent integration smoke — regression guard for the hermes-agent wiring.
#
# WHY THIS EXISTS:
#   Plan 5 (Hermes Agent → GLM 5.2 + Telegram) was marked 7/7 done, but no step ever ran the
#   external `hermes` binary end-to-end. The command `hermes run` in tools/run-hermes-agent.mjs
#   didn't exist in upstream hermes-agent (0.13–0.19), and the bug stayed hidden because every
#   DoD was a static check (file exists, grep, node -c). See docs/lessons/hermes-agent-dod-failure.md.
#
# WHAT THIS SMOKE CHECKS (without real Telegram/GLM keys — CI cannot have them):
#   1. tools/run-hermes-agent.mjs invokes `gateway run`, NOT the non-existent `run` subcommand.
#   2. tools/doctor-hermes-agent.mjs invokes NO hermes binary (stays read-only, as documented).
#   3. MCP server builds and starts via stdio.
#   4. Hermes Gateway health endpoint responds (if gateway is running; skip otherwise).
#   5. hermes-config.yaml points at GLM 5.2 + Telegram enabled (regression guard on config shape).
#
# WHAT THIS SMOKE DOES NOT CHECK (requires secrets + external binary, out of CI scope):
#   - Real Telegram bot round-trip (needs TELEGRAM_BOT_TOKEN + operator interaction)
#   - Real GLM 5.2 completion (needs HERMES_LLM_API_KEY)
#   - Real `hermes gateway run` startup (needs the external binary installed)
#   Those are covered by the manual runtime DoD in .cursor/plans/hermes-agent-glm/H5-G-RUNTIME.md.
#
# Usage: bash tools/ci-hermes-agent-smoke.sh
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

echo "── ci-hermes-agent-smoke ──"
echo ""

# ── 1. run-hermes-agent.mjs uses `gateway run`, not the non-existent `run` ──
RUN_SCRIPT="tools/run-hermes-agent.mjs"
if [[ ! -f "$RUN_SCRIPT" ]]; then
  fail "$RUN_SCRIPT not found"
else
  # The args array must contain 'gateway' and 'run' as separate tokens (hermes gateway run).
  if grep -qE "args\s*=\s*\[['\"]gateway['\"]" "$RUN_SCRIPT" && \
     grep -qE "['\"]run['\"]" "$RUN_SCRIPT"; then
    ok "$RUN_SCRIPT invokes 'hermes gateway run' (correct subcommand)"
  else
    fail "$RUN_SCRIPT does NOT invoke 'gateway run' — regression: non-existent 'hermes run' returned?"
  fi
  # Negative guard: must not contain the bare 'run' as a standalone subcommand (old bug).
  if grep -qE "args\s*=\s*\[['\"]run['\"]" "$RUN_SCRIPT"; then
    fail "$RUN_SCRIPT still uses 'hermes run' (non-existent subcommand) — see docs/lessons/hermes-agent-dod-failure.md"
  fi
fi

# ── 2. doctor-hermes-agent.mjs stays read-only (no spawn of hermes binary) ──
DOCTOR_SCRIPT="tools/doctor-hermes-agent.mjs"
if [[ ! -f "$DOCTOR_SCRIPT" ]]; then
  fail "$DOCTOR_SCRIPT not found"
else
  if grep -qiE "spawn\s*\(\s*['\"]hermes['\"]" "$DOCTOR_SCRIPT"; then
    fail "$DOCTOR_SCRIPT spawns the hermes binary — violates its 'read-only' contract (header says 'ничего не запускает')"
  else
    ok "$DOCTOR_SCRIPT stays read-only (does not spawn hermes binary)"
  fi
  # Positive guard: doctor must document itself as read-only.
  if grep -qiE "(read-only|ничего не запускает|не запускает агент)" "$DOCTOR_SCRIPT"; then
    ok "$DOCTOR_SCRIPT documents itself as read-only"
  else
    fail "$DOCTOR_SCRIPT missing read-only self-documentation"
  fi
fi

# ── 3. MCP server builds ──
if npm run build:hermes-mcp >/dev/null 2>&1; then
  ok "npm run build:hermes-mcp succeeds"
else
  fail "npm run build:hermes-mcp failed"
fi
if [[ -f "packages/hermes-mcp-server/dist/index.js" ]]; then
  ok "MCP server dist/index.js exists"
else
  fail "MCP server dist/index.js missing after build"
fi

# ── 4. MCP server starts via stdio (3s smoke) ──
MCP_SMOKE_OUT="$(timeout 3 node packages/hermes-mcp-server/dist/index.js 2>&1 || true)"
if echo "$MCP_SMOKE_OUT" | grep -qiE "(stdio|connected|gateway)"; then
  ok "MCP server starts and connects via stdio"
else
  fail "MCP server did not report stdio connection within 3s"
fi

# ── 5. hermes-config.yaml points at GLM 5.2 + Telegram enabled ──
CONFIG_YAML="tools/hermes-agent/hermes-config.yaml"
if [[ ! -f "$CONFIG_YAML" ]]; then
  fail "$CONFIG_YAML not found"
else
  if grep -q "glm-5.2" "$CONFIG_YAML"; then
    ok "config targets GLM 5.2"
  else
    fail "config does not reference glm-5.2 (regression)"
  fi
  if grep -qiE "telegram.*enabled.*true|HERMES_TELEGRAM_ENABLED:true" "$CONFIG_YAML"; then
    ok "config enables Telegram"
  else
    fail "config does not enable Telegram (regression)"
  fi
fi

# ── 6. .env.example documents the hermes-agent section ──
if grep -q "HERMES_LLM_API_KEY" .env.example && grep -q "TELEGRAM_BOT_TOKEN" .env.example; then
  ok ".env.example documents hermes-agent secrets"
else
  fail ".env.example missing hermes-agent secret documentation"
fi

# ── 7. Gateway health (optional — skip if not running, this is CI-friendly) ──
GW_HEALTH="$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 http://127.0.0.1:3020/health 2>/dev/null || echo "000")"
if [[ "$GW_HEALTH" == "200" ]]; then
  ok "Hermes Gateway health responds 200"
else
  echo "[skip] Hermes Gateway not running (HTTP $GW_HEALTH) — ok in CI, run npm run dev:hermes locally"
fi

echo ""
if (( failures > 0 )); then
  printf 'ci-hermes-agent-smoke: FAIL — %d regression(s). See docs/lessons/hermes-agent-dod-failure.md.\n' "$failures" >&2
  exit 1
fi
echo "ci-hermes-agent-smoke: ok (wiring intact; runtime round-trip needs manual DoD H5-G-RUNTIME)"
