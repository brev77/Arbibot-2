#!/usr/bin/env bash
# docs-freshness guard — structural drift detector for foundational docs.
#
# WHY THIS EXISTS:
#   Foundational docs (AGENTS.md, CONTEXT.md, state-machines.md, outbox-inbox.md, plan
#   tables, roadmap-vectors) drifted significantly from code/migrations in PLAN9/10/13:
#   migration ranges stuck at 001-043 while 54 migrations existed; plan tables marked
#   `proposed` after code was merged; skills count 7 in index while 15 files existed;
#   `cross_chain_reconciliation` table documented that never existed in schema.
#   Manual audits caught these only after they mislead the operator. This script catches
#   the same classes of drift automatically, on every push to docs/code + weekly cron.
#
# ⚠️ STRUCTURAL CHECKS ONLY. These checks verify numbers, file existence, links, schema
#    references — things a grep can confirm. They do NOT catch SEMANTIC drift: a doc
#    claiming "on_chain_transactions has 0 writers" while a writer exists in code, or a
#    stale qualitative claim ("safe-by-default false" while server has it `true`). For
#    semantic drift, use a future Hermes `docs-audit` skill or human review.
#
# WHAT THIS CHECKS (11 checks):
#   1.  Migration range consistency (001-0NN in docs vs actual migration file count)
#   2.  Hermes skills count (N skills claims vs files in tools/hermes-agent/skills/)
#   3.  MCP tools count (registerTool() calls vs "N tools" claim)
#   4.  Dead relative markdown links (](path.md) → fs.existsSync
#   4b. Dead code-block paths (`apps/**/*.ts`, `packages/**/*.ts`) → fs.existsSync
#   5.  DOCUMENTS_INDEX coverage (git ls-files docs/*.md vs index links)
#   6.  Plan status vs git (table `proposed` + git log has commits → FAIL, allowlist)
#   7.  Schema reference integrity (table names in docs vs CREATE TABLE in migrations)
#   8.  State enum completeness [experimental, non-fatal] (explicit lists vs CHECK constraints)
#   9.  Cron↔skill mapping (delegates to ci-hermes-agent-smoke.sh check #9)
#   10. ENV var references (`ENV_VAR` in docs vs .env.example)
#   11. AGENTS.md verification-stamp age (3-day rule; stale only with git activity)
#
# ALLOWLIST: tools/docs-freshness-baseline.txt — legit exceptions (historical snapshots,
#   frozen canonical specs, partially-delivered plans). Format documented in the file.
#
# Usage: bash tools/ci-docs-freshness.sh
# Exit codes: 0 = ok (or only experimental warnings), 1 = structural drift found.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# ── Helpers ────────────────────────────────────────────────────────────────────
failures=0          # fatal — increments exit code to 1
experimental=0      # non-fatal — Check 8 only; reported but never fails
fail() {
  printf '[FAIL] %s\n' "$1" >&2
  failures=$((failures + 1))
}
warn_exp() {
  printf '[warn] [experimental] %s\n' "$1" >&2
  experimental=$((experimental + 1))
}
ok()    { printf '[ok]   %s\n' "$1"; }
info()  { printf '       %s\n' "$1"; }

# ── Allowlist loader ───────────────────────────────────────────────────────────
BASELINE="tools/docs-freshness-baseline.txt"
# is_allowed <path> <finding>  → returns 0 (allowed) or 1 (not allowed)
# Matches against baseline entries: path (glob) + pattern (regex against finding).
is_allowed() {
  local fpath="$1" finding="$2"
  [[ ! -f "$BASELINE" ]] && return 1
  while IFS='|' read -r bpath bpattern breason bexpiry; do
    # Skip comments and blank lines.
    [[ -z "$bpath" || "$bpath" =~ ^[[:space:]]*# ]] && continue
    # Path match: support `*` wildcard (basename match against full path).
    # If bpath contains a slash, match full path; else match basename.
    local path_match=1
    if [[ "$bpath" == "*" ]]; then
      path_match=0
    elif [[ "$bpath" == */* ]]; then
      # glob match against full path
      # shellcheck disable=SC2254
      case "$fpath" in
        "$bpath") path_match=0 ;;
      esac
    else
      # basename match
      case "$(basename "$fpath")" in
        "$bpath") path_match=0 ;;
      esac
    fi
    [[ $path_match -ne 0 ]] && continue
    # Pattern match: `*` matches any; else regex against finding.
    if [[ "$bpattern" == "*" ]]; then
      return 0
    elif echo "$finding" | grep -qE "$bpattern"; then
      return 0
    fi
  done < "$BASELINE"
  return 1
}

# expired_allowlist_entries → prints warnings for @expiry dates in the past.
check_allowlist_expiry() {
  local today
  today="$(date +%Y-%m-%d)"
  [[ ! -f "$BASELINE" ]] && return
  while IFS='|' read -r bpath bpattern breason bexpiry; do
    [[ -z "$bpath" || "$bpath" =~ ^[[:space:]]*# ]] && continue
    [[ -z "$bexpiry" ]] && continue
    [[ "$bexpiry" == *"never"* ]] && continue
    # Extract YYYY-MM-DD from `@expiry:YYYY-MM-DD`.
    local expiry_date
    expiry_date="$(echo "$bexpiry" | grep -oE '[0-9]{4}-[0-9]{2}-[0-9]{2}' || true)"
    [[ -z "$expiry_date" ]] && continue
    if [[ "$expiry_date" < "$today" ]]; then
      printf '[warn] allowlist entry EXPIRED: %s (expired %s) — review and renew or remove\n' \
        "$bpath" "$expiry_date" >&2
    fi
  done < "$BASELINE"
}

echo "── ci-docs-freshness ──"
echo ""

# ── Check 1: Migration range consistency ───────────────────────────────────────
# Count actual migration files, then scan docs/AGENTS.md/CONTEXT.md for "001–0NN"
# patterns and verify the max equals the actual count.
migration_count=$(find infra/postgres/migrations -maxdepth 1 -name '*.sql' | wc -l | tr -d ' ')
doc_max_migration=0
docs_to_scan_1="AGENTS.md CONTEXT.md README.md $(find docs -maxdepth 2 -name '*.md' -type f)"
# NOTE: printf word-splits the list so each path lands on its own line. A herestring
# (`done <<< "$docs_to_scan_1"`) would glue "AGENTS.md CONTEXT.md README.md <first find
# result>" into ONE line → -f fails → AGENTS.md/CONTEXT.md/README.md never scanned.
while IFS= read -r f; do
  [[ -f "$f" ]] || continue
  while read -r m; do
    [[ -z "$m" ]] && continue
    # Allowlist check: historical snapshots keep old ranges legitimately.
    if is_allowed "$f" "$m"; then continue; fi
    if (( m > doc_max_migration )); then
      doc_max_migration=$m
    fi
  done < <(grep -oE "001[–-]0([0-9])([0-9])" "$f" 2>/dev/null \
           | sed -E 's/^001[–-]0//' | sed -E 's/^0//' | sort -n)
done < <(printf '%s\n' $docs_to_scan_1)
if (( doc_max_migration == migration_count )); then
  ok "Check 1: migration range matches actual count (${migration_count} migrations, docs max ${doc_max_migration})"
elif (( doc_max_migration < migration_count )); then
  fail "Check 1: docs max migration range (${doc_max_migration}) < actual file count (${migration_count}) — AGENTS.md / docs need updating to 001–$(printf '%03d' "$migration_count")"
else
  fail "Check 1: docs max migration range (${doc_max_migration}) > actual file count (${migration_count}) — a migration was deleted but docs not updated, or a typo"
fi

# ── Check 2: Hermes skills count ───────────────────────────────────────────────
skills_actual=$(find tools/hermes-agent/skills -maxdepth 1 -name '*.md' 2>/dev/null | wc -l | tr -d ' ')
skills_doc_max=0
for f in AGENTS.md docs/hermes-reference.md docs/DOCUMENTS_INDEX.md; do
  [[ -f "$f" ]] || continue
  while read -r n; do
    [[ -z "$n" ]] && continue
    if (( n > skills_doc_max )); then skills_doc_max=$n; fi
  done < <(grep -hoE "[0-9]+ (Arbibot-specific |hermes )?skills|[0-9]+ skills|[0-9]+ шт\.|[0-9]+ командных" "$f" 2>/dev/null \
           | grep -oE '^[0-9]+' | sort -n)
done
if (( skills_actual == 0 )); then
  echo "[skip] Check 2: no skills dir (tools/hermes-agent/skills/ missing)"
elif (( skills_doc_max == 0 )); then
  echo "[skip] Check 2: no skill-count claim found in docs (nothing to verify)"
elif (( skills_doc_max == skills_actual )); then
  ok "Check 2: skills count matches (${skills_actual} files, docs claim ${skills_doc_max})"
else
  fail "Check 2: skills count mismatch — docs claim ${skills_doc_max}, actual files ${skills_actual} (see tools/hermes-agent/skills/)"
fi

# ── Check 3: MCP tools count ───────────────────────────────────────────────────
mcp_dir="packages/hermes-mcp-server/src/tools"
if [[ -d "$mcp_dir" ]]; then
  tools_actual=$(grep -hcE "^\s*registerTool\(" "$mcp_dir"/*.ts 2>/dev/null | awk '{s+=$1} END{print s}')
  tools_claim=""
  for f in AGENTS.md "$mcp_dir/index.ts"; do
    [[ -f "$f" ]] || continue
    # Match "N tools" (N operational + M + K + L) or "exposing N tools"
    tools_claim=$(grep -hoE "exposing [0-9]+ tools|[0-9]+ tools total|[0-9]+ tools" "$f" 2>/dev/null | grep -oE '[0-9]+' | sort -n | tail -1)
    [[ -n "$tools_claim" ]] && break
  done
  if [[ -z "$tools_claim" ]]; then
    echo "[skip] Check 3: no MCP tool count claim found"
  elif (( tools_actual == tools_claim )); then
    ok "Check 3: MCP tools count matches (${tools_actual} registerTool calls, docs claim ${tools_claim})"
  else
    fail "Check 3: MCP tools count mismatch — docs claim ${tools_claim}, actual registerTool calls ${tools_actual} (see $mcp_dir/*.ts)"
  fi
else
  echo "[skip] Check 3: MCP server tools dir missing ($mcp_dir)"
fi

# ── Check 4: Dead relative markdown links ──────────────────────────────────────
# For each ](path) in docs, resolve relative to the file's directory and check existence.
# Skip: http(s)://, #anchor-only, mailto:, absolute file paths.
dead_links=""
for f in $(find docs -maxdepth 3 -name '*.md' -type f) AGENTS.md CONTEXT.md README.md; do
  [[ -f "$f" ]] || continue
  fdir="$(cd "$(dirname "$f")" && pwd)"
  # Extract link targets: everything between ]( and ).
  while IFS= read -r link; do
    [[ -z "$link" ]] && continue
    # Strip anchor.
    target="${link%%#*}"
    [[ -z "$target" ]] && continue
    # Skip external and non-relative.
    case "$target" in
      http://*|https://*|mailto:*|/\ *) continue ;;
    esac
    # Resolve relative to the file's dir.
    resolved="$fdir/$target"
    if [[ ! -e "$resolved" ]]; then
      if is_allowed "$f" "$link"; then continue; fi
      dead_links="$dead_links\n  $f → $link"
    fi
  done < <(grep -oE '\]\([^)]+\)' "$f" 2>/dev/null | sed -E 's/^\]\(//; s/\)$//')
done
if [[ -z "$dead_links" ]]; then
  ok "Check 4: no dead relative markdown links found"
else
  fail "Check 4: dead relative markdown links found:"
  printf '%b\n' "$dead_links" >&2
fi

# ── Check 4b: Dead code-block paths ────────────────────────────────────────────
# Catch backtick-quoted paths like `apps/foo/bar.ts` `packages/baz/qux.ts` that no
# longer exist. AGENTS.md references many code files this way (not as markdown links).
dead_code_paths=""
for f in AGENTS.md CONTEXT.md README.md; do
  [[ -f "$f" ]] || continue
  while IFS= read -r p; do
    [[ -z "$p" ]] && continue
    if [[ ! -e "$p" ]]; then
      if is_allowed "$f" "$p"; then continue; fi
      dead_code_paths="$dead_code_paths\n  $f → \`$p\`"
    fi
  done < <(grep -oE '`(apps|packages)/[a-zA-Z0-9_/.-]+\.(ts|js|mjs|json|yaml|yml|sql|md)`' "$f" 2>/dev/null \
           | sed -E 's/^`//; s/`$//')
done
if [[ -z "$dead_code_paths" ]]; then
  ok "Check 4b: no dead code-block paths in AGENTS.md/CONTEXT.md/README.md"
else
  fail "Check 4b: dead code-block paths found:"
  printf '%b\n' "$dead_code_paths" >&2
fi

# ── Check 5: DOCUMENTS_INDEX coverage ──────────────────────────────────────────
index_file="docs/DOCUMENTS_INDEX.md"
if [[ -f "$index_file" ]]; then
  # All tracked docs/*.md files (recursive).
  missing_from_index=""
  while IFS= read -r tracked; do
    bn=$(basename "$tracked")
    # If the basename is NOT referenced anywhere in the index → missing.
    if ! grep -q "$bn" "$index_file" 2>/dev/null; then
      if is_allowed "$index_file" "$bn"; then continue; fi
      missing_from_index="$missing_from_index\n  $tracked"
    fi
  done < <(git ls-files 'docs/*.md' 2>/dev/null)
  if [[ -z "$missing_from_index" ]]; then
    ok "Check 5: DOCUMENTS_INDEX covers all tracked docs/*.md"
  else
    fail "Check 5: tracked docs/*.md files missing from DOCUMENTS_INDEX.md:"
    printf '%b\n' "$missing_from_index" >&2
  fi
else
  echo "[skip] Check 5: $index_file not found"
fi

# ── Check 6: Plan status vs git ────────────────────────────────────────────────
# For each DEVELOPMENT_PLAN{N}.md: if the step/initiative table contains a row with
# status `proposed` or `accepted` AND `git log --grep "PLAN N"` returns commits → FAIL
# (code merged but status stale). `accepted` = "accepted into plan, not yet started";
# `proposed` = "formulated only". Both are stale if code is merged.
# Allowlist covers legit partial-delivery (P9-12 ops, P10-9 smoke).
plans_with_stale_status=""
for plan in .cursor/plans/DEVELOPMENT_PLAN*.md; do
  [[ -f "$plan" ]] || continue
  # Extract plan number (e.g. "9" from DEVELOPMENT_PLAN9.md).
  pnum=$(echo "$plan" | grep -oE 'PLAN[0-9]+' | grep -oE '[0-9]+' || true)
  [[ -z "$pnum" ]] && continue
  # Look for table rows with `proposed` or `accepted` status (stale if code merged).
  while IFS= read -r line; do
    [[ -z "$line" ]] && continue
    # Allowlist check.
    if is_allowed "$plan" "$line"; then continue; fi
    # Does git have commits for this plan?
    commits=$(git log --oneline --all --grep="PLAN${pnum}" --grep="P${pnum}-" 2>/dev/null | wc -l | tr -d ' ')
    if (( commits > 0 )); then
      plans_with_stale_status="$plans_with_stale_status\n  $plan: $line (git has ${commits} commits for PLAN${pnum})"
    fi
  done < <(grep -nE '\|.*\b(proposed|accepted)\b' "$plan" 2>/dev/null)
done
if [[ -z "$plans_with_stale_status" ]]; then
  ok "Check 6: no stale 'proposed' statuses in plan tables (or all covered by allowlist)"
else
  fail "Check 6: plan table shows 'proposed' but git has commits (status stale):"
  printf '%b\n' "$plans_with_stale_status" >&2
  info "If partial-delivery is legit, add a baseline entry to $BASELINE"
fi

# ── Check 7: Schema reference integrity ────────────────────────────────────────
# Compares table names mentioned in core arch docs against the ACTUAL list of tables
# created by migrations. Catches documented tables that were never created (e.g.
# cross_chain_reconciliation — in-memory service mistaken for a table).
# Strategy: extract real table names from CREATE TABLE statements, then flag any
# backtick-quoted token in docs that LOOKS like a table (snake_case + in a table-like
# context) but is NOT in the real-tables set.
migrations_blob="$(cat infra/postgres/migrations/*.sql 2>/dev/null || true)"
schema_docs="docs/aggregates.md docs/outbox-inbox.md docs/state-machines.md docs/reservation-first.md docs/async-events.md"
# Build the set of real table names from migrations.
real_tables_file="$(mktemp)"
grep -hoiE "CREATE TABLE[^;]*" infra/postgres/migrations/*.sql 2>/dev/null \
  | grep -oE "(IF NOT EXISTS[[:space:]]+)?[a-z_]+[[:space:]]*\(" \
  | sed -E 's/[[:space:]]*\($//; s/IF NOT EXISTS[[:space:]]+//' \
  | tr '[:upper:]' '[:lower:]' | sort -u > "$real_tables_file"
# Known column names that are commonly backtick-quoted in docs and should NOT be
# mistaken for tables. This is a denylist of common false positives.
column_denylist='entity_version|created_at|updated_at|message_id|correlation_id|causation_id|processed_at|relay_dead_letter_at|relay_delivery_attempts|paper_enqueue_idempotency_key|block_number|tx_hash|leg_id|route_key|cost_breakdown|playbook_config|entry_price|exit_price|profit_usd|settled_at|live_execution_plan_id|gas_used|gas_limit|gas_price|input_data|revert_reason|nonce|from_address|to_address|estimated_gas_usd|slippage_bps|pool_fee_usd|bridge_fee_usd|total_cost_usd|cost_confidence|filled_quantity|target_quantity|venue_ref|event_type|entity_type|entity_id|source_module|event_ts|eventName|messageId|correlationId|causationId|version|state|status|consumer_id|instrument_key|notional|expires_at|trade_id|risk_decision_id|plan_id|schema_version|capital_reservation_id'

missing_tables=""
for f in $schema_docs; do
  [[ -f "$f" ]] || continue
  while IFS= read -r tok; do
    [[ -z "$tok" ]] && continue
    # Skip if it is a real table.
    grep -qxF "$tok" "$real_tables_file" && continue
    # Skip if it is a known column name.
    echo "$tok" | grep -qE "^($column_denylist)$" && continue
    # Skip state values.
    case "$tok" in
      active|expired|released|planned|reserved|armed|executing|completed|hedged|unwound|failed|canceled|created|submitting|sent|acknowledged|partiallyFilled|filled|rejected|timedOut|detected|enriched|risk_checked|live_failed|bus|pending|confirmed|reverted) continue ;;
    esac
    # Must look like a table (snake_case, at least one underscore, not a single word).
    [[ ! "$tok" =~ _ ]] && continue
    # Allowlist.
    if is_allowed "$f" "$tok"; then continue; fi
    # Dedup.
    if echo "$missing_tables" | grep -q "$tok"; then continue; fi
    missing_tables="$missing_tables\n  $tok (mentioned in $f but no CREATE TABLE in migrations)"
  done < <(grep -oE '`[a-z][a-z_]+`' "$f" 2>/dev/null | sed -E 's/`//g' | sort -u)
done
rm -f "$real_tables_file"
if [[ -z "$missing_tables" ]]; then
  ok "Check 7: all table references in arch docs have CREATE TABLE in migrations"
else
  fail "Check 7: table names mentioned in arch docs but no CREATE TABLE in migrations:"
  printf '%b\n' "$missing_tables" >&2
  info "If the name refers to an in-memory service or column, add to baseline"
fi

# ── Check 8: State enum completeness [EXPERIMENTAL, non-fatal] ──────────────────
# Compares explicit "Допустимые значения" lists in docs/state-machines.md against
# CHECK constraints in migrations. Mermaid diagrams are NOT parsed (too brittle).
# Only parses lines where the backtick-quoted state list is ON THE SAME LINE as the
# "Допустимые значения" header — lines with a migration source-ref on the header line
# (state list on the next line) are skipped to avoid false positives.
# This check produces warnings only — never fails the build.
sm_file="docs/state-machines.md"
if [[ -f "$sm_file" ]]; then
  # Find explicit state lists: lines like "**Допустимые значения** (...): `a, b, c`"
  # Skip lines where the only backtick content is a migration filename (contains .sql).
  while IFS= read -r line; do
    [[ -z "$line" ]] && continue
    # Extract backtick-quoted content; skip if it looks like a filename.
    states_list=$(echo "$line" | grep -oE '`[^`]+`' | head -1 | sed -E 's/`//g')
    [[ -z "$states_list" ]] && continue
    [[ "$states_list" =~ \.sql ]] && continue
    [[ "$states_list" =~ ^[0-9]+_ ]] && continue
    # For each state value in the list, check it appears in a migration CHECK constraint.
    for st in $(echo "$states_list" | tr ',' '\n' | sed -E 's/^ *//;s/ *$//'); do
      [[ -z "$st" ]] && continue
      # Look for this state value inside a CHECK ... state ... ARRAY constraint.
      if ! echo "$migrations_blob" | grep -qiE "CHECK.*state.*ARRAY.*${st}"; then
        warn_exp "state value '$st' (in $sm_file explicit list) not found in any migration CHECK constraint"
      fi
    done
  done < <(grep -E "Допустимые значения|allowed values" "$sm_file" 2>/dev/null)
  if (( experimental == 0 )); then
    ok "Check 8: [experimental] state enum lists consistent with migration CHECKs"
  else
    info "Check 8 is experimental/non-fatal — mermaid diagrams not parsed"
  fi
else
  echo "[skip] Check 8: $sm_file not found"
fi

# ── Check 9: Cron↔skill mapping (delegate) ─────────────────────────────────────
# This check is already implemented in ci-hermes-agent-smoke.sh (check #9).
# Delegating avoids duplication. If that script is absent, skip with warning.
if [[ -f tools/ci-hermes-agent-smoke.sh ]]; then
  if bash tools/ci-hermes-agent-smoke.sh >/dev/null 2>&1; then
    ok "Check 9: cron↔skill mapping intact (delegated to ci-hermes-agent-smoke.sh)"
  else
    fail "Check 9: ci-hermes-agent-smoke.sh failed (cron↔skill mapping broken) — run it directly for details"
  fi
else
  echo "[skip] Check 9: tools/ci-hermes-agent-smoke.sh not found (cannot delegate cron↔skill check)"
fi

# ── Check 10: ENV var references ───────────────────────────────────────────────
# Parse .env.example (both `NAME=` and `# NAME=` forms) for declared env vars.
# For each `ENV_VAR_NAME` mentioned in AGENTS.md/CONTEXT.md/README.md, verify it
# exists in .env.example. Catches stale/renamed env vars referenced in docs.
env_example=".env.example"
if [[ -f "$env_example" ]]; then
  # Collect declared env var names: lines starting with NAME= or # NAME= (optional/commented).
  env_declared="$(mktemp)"
  grep -oE '^[[:space:]]*#?[[:space:]]*[A-Z][A-Z_]{2,}=' "$env_example" 2>/dev/null \
    | sed -E 's/^[[:space:]]*#?[[:space:]]*//; s/=$//' \
    | sort -u > "$env_declared"
  # Known env var prefixes that are service-name-derived (skip generic API_BASE suffix check).
  env_docs_drift=""
  for f in AGENTS.md CONTEXT.md README.md; do
    [[ -f "$f" ]] || continue
    while IFS= read -r var; do
      [[ -z "$var" ]] && continue
      # Allowlist: skip if this var mention is allowed.
      if is_allowed "$f" "$var"; then continue; fi
      # Skip obvious non-env tokens (single word, too short, contains lowercase).
      [[ ! "$var" =~ ^[A-Z][A-Z0-9_]{3,}$ ]] && continue
      # Skip common false positives: TS types, file extensions, acronyms, CLI flags,
      # error codes, export formats, markdown tokens.
      case "$var" in
        HERMES|PLAN|PR|TODO|CI|HTTP|HTTPS|API|RPC|WAL|EVM|DEX|ETH|WETH|USDC|USDT|TTL|URL|URI|JSON|SQL|DTO|OTS|UTF|UUID|MCP|TLS|mTLS|D4|H5|P7|P8|P9|P10|P11|P12|P13|CFG|PAD|ADR|NODE|ENV|DEV|PROD|TEST|LOCAL|REMOTE|MAIN) continue ;;
        # CLI flags / formats / methods / error codes — not env vars.
        FORMAT|PATCH|POST|GET|PUT|DELETE|HEAD|OPTIONS|LICENSE|README|CHANGELOG|ROUTE_KEY|LOOKBACK_HOURS|TRANSFER_FROM_FAILED|PROXY|SCHEMA|STDOUT|STDERR|TCP|UDP|AWS|GCP|AZURE|OS|CPU|RAM|SSD|HDD|CDN|DNS|DHCP|NAT|VLAN|VPN|WAF|IDS|IPS|SIEM|SOC|SLA|SLO|TLS|mTLS|JWT|JWS|JWE|PKCE|OAUTH|OIDC|SAML|LDAP|SSO|TOTP|HOTP|MFA|FA|RBAC|ABAC|PBAC|REBAC|ACL|CRUD|BFF|SSR|CSR|SGC|ISR|PRPL|RSC|RPC|GraphQL|REST|SOAP|GRPC|GRPC-Web|WebSocket|SSE|MQTT|AMQP|STOMP|XMPP|IRC|SMS|MMS|SMTP|IMAP|POP3|FTP|SFTP|SCP|RSYNC|TAR|GZIP|BZIP2|ZIP|RAR|PCKG) continue ;;
      esac
      if ! grep -qxF "$var" "$env_declared"; then
        # Dedup per var.
        if echo "$env_docs_drift" | grep -q "$var in $f"; then continue; fi
        env_docs_drift="$env_docs_drift\n  \`$var\` mentioned in $f but not in $env_example"
      fi
    done < <(grep -oE '`[A-Z][A-Z0-9_]{3,}`' "$f" 2>/dev/null | sed -E 's/`//g' | sort -u)
  done
  rm -f "$env_declared"
  if [[ -z "$env_docs_drift" ]]; then
    ok "Check 10: ENV vars in docs exist in .env.example"
  else
    # Advisory-only: .env.example completeness is a known project gap (many operator
    # env vars are documented in AGENTS.md but not yet added to .env.example). This
    # check signals the gap but does NOT fail the build — failing would block every
    # PR until .env.example is fully backfilled, which is a separate initiative.
    # Toggle to fatal once .env.example is comprehensive.
    printf '[advise] Check 10: ENV vars referenced in docs missing from .env.example:\n' >&2
    printf '%b\n' "$env_docs_drift" >&2
    info "Advisory-only (non-fatal) — .env.example completeness is a separate initiative"
  fi
else
  echo "[skip] Check 10: $env_example not found"
fi

# ── Check 11: AGENTS.md verification-stamp age vs git activity ──────────────────
# AGENTS.md (§ Maintenance) must be re-verified against CODE every 3 days; the
# stamp line records the last verification (covers AGENTS.md + key docs list).
# Stale only if BOTH: stamp older than 3 days AND commits landed after the stamp
# date (a quiet repo cannot make the doc drift). Enforces the behavioral rule
# structurally: a skipped or rubber-stamped maintenance run turns CI red.
if [[ -f "AGENTS.md" ]]; then
  stamp_date="$(grep -oE 'Last verified against code: [0-9]{4}-[0-9]{2}-[0-9]{2}' AGENTS.md 2>/dev/null | grep -oE '[0-9]{4}-[0-9]{2}-[0-9]{2}' | tail -1)"
  if [[ -z "$stamp_date" ]]; then
    fail "Check 11: AGENTS.md lacks 'Last verified against code: YYYY-MM-DD' stamp (see AGENTS.md ## Maintenance)"
  else
    age_days=$(( ( $(date +%s) - $(date -d "$stamp_date" +%s) ) / 86400 ))
    commits_since=$(git log --since="${stamp_date} 23:59:59" --oneline 2>/dev/null | wc -l | tr -d ' ')
    if (( age_days > 3 && commits_since > 0 )) && ! is_allowed "AGENTS.md" "stamp ${stamp_date} age ${age_days}d"; then
      fail "Check 11: AGENTS.md verification stamp stale — ${age_days}d old, ${commits_since} commits since ${stamp_date}. Run the maintenance check (AGENTS.md ## Maintenance), then bump the stamp."
    else
      ok "Check 11: AGENTS.md verification stamp OK (${stamp_date}, ${age_days}d old, ${commits_since} commits since)"
    fi
  fi
else
  echo "[skip] Check 11: AGENTS.md not found"
fi

# ── Allowlist expiry warnings ──────────────────────────────────────────────────
check_allowlist_expiry

# ── Summary ────────────────────────────────────────────────────────────────────
echo ""
if (( failures > 0 )); then
  printf 'ci-docs-freshness: FAIL — %d structural drift finding(s).' "$failures" >&2
  if (( experimental > 0 )); then
    printf ' (+%d experimental warning(s), non-fatal)' "$experimental" >&2
  fi
  printf '\n' >&2
  printf 'Fix the drift, or add a justified line to %s if it is legit.\n' "$BASELINE" >&2
  exit 1
fi
if (( experimental > 0 )); then
  printf 'ci-docs-freshness: ok with %d experimental warning(s) (non-fatal, Check 8).\n' "$experimental"
else
  echo "ci-docs-freshness: ok (foundational docs consistent with code/migrations/skills)"
fi
exit 0
