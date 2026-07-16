#!/usr/bin/env bash
# Paper/live import-graph boundary guard (C3 in dex-security-and-capital-safety SKILL.md).
#
# Enforces the import contract from
#   .cursor/skills/dex-security-and-capital-safety/references/paper-live-boundary.md
# (section "Запрещённые импорты"). Without this CI gate, contamination regresses would only
# be caught if a reviewer remembers to run the dex-security skill.
#
# Contract PL.1 — apps/paper-trading-service/src/ MUST NOT import live-side modules:
#   - @arbibot/capital-service              (live capital write path)
#   - @arbibot/execution-orchestrator       (live plan + wallet modules)
#   - WalletManagerService / KeyVaultService / getEncryptedKey / decryptPrivateKey
#     (live wallet sign — plaintext key must never reach paper path)
#
# Contract PL.2 — live services MUST NOT depend on paper-only write artifacts at runtime:
#   - execution-orchestrator live path MUST NOT import paper-trading-service / PaperCapitalService
#   - capital-service MUST NOT import PaperCapitalReservation write path
#   (Shared types go through @arbibot/contracts — that IS the boundary, and is allowed.)
#
# Scope: production code only (*.ts under apps/, excluding tests/mocks/specs/d.ts).
# We scan import STATEMENTS only (lines starting with `import` / `export ... from`), not bare
# mentions in comments or string literals — see PL.3 "Shared types via @arbibot/contracts".
#
# Usage: bash tools/ci-paper-live-boundary.sh
# Exit codes: 0 = clean, 1 = contamination (CI fails).

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

findings=0
PAPER_DIR="apps/paper-trading-service/src"
EXEC_DIR="apps/execution-orchestrator/src"
CAPITAL_DIR="apps/capital-service/src"

# Gather production *.ts files under a directory, excluding tests/mocks/d.ts.
# Args: <dir>
gather_ts() {
  local dir="$1"
  if [[ ! -d "$dir" ]]; then
    return
  fi
  find "$dir" -type f -name '*.ts' 2>/dev/null \
    | grep -vE '(^|/)(node_modules|dist|\.turbo|coverage)/' \
    | grep -vE '\.(spec|test|d)\.ts$' \
    | grep -vE '(^|/)(__mocks__|__fixtures__|mocks|fixtures|fakes)/' \
    | grep -vE '\.mock\.ts$' \
    || true
}

# scan_imports <rule_id> <description> <dir> <pattern>
# Reports lines matching <pattern> that are import/export-from statements within <dir>.
scan_imports() {
  local rule_id="$1" description="$2" dir="$3" pattern="$4" files out
  files="$(gather_ts "$dir")"
  if [[ -z "$files" ]]; then
    return
  fi
  # Match import / re-export statements containing the forbidden pattern.
  out="$(echo "$files" | xargs -r grep -nIE "^[[:space:]]*(import|export[^=]*from|}[[:space:]]*from)[[:space:]].*${pattern}" 2>/dev/null || true)"
  if [[ -n "$out" ]]; then
    printf '\n[%s] %s\n' "$rule_id" "$description" >&2
    printf '%s\n' "$out" >&2
    findings=$((findings + 1))
  fi
}

# ----- PL.1: paper-trading-service must not import live modules -------------------
scan_imports "PL1-paper-imports-capital" \
  "paper-trading-service imports live capital-service (write path)" \
  "$PAPER_DIR" \
  "@arbibot/capital-service"

scan_imports "PL1-paper-imports-execution" \
  "paper-trading-service imports live execution-orchestrator (plan + wallet modules)" \
  "$PAPER_DIR" \
  "@arbibot/execution-orchestrator"

# Live wallet sign services. Match either the package import or the class name.
scan_imports "PL1-paper-imports-wallet" \
  "paper-trading-service imports live wallet/key sign path (WalletManager / KeyVault / getEncryptedKey / decryptPrivateKey)" \
  "$PAPER_DIR" \
  "(WalletManagerService|KeyVaultService|getEncryptedKey|decryptPrivateKey)"

# ----- PL.2: live services must not depend on paper-only write artifacts ----------
scan_imports "PL2-exec-imports-paper" \
  "execution-orchestrator imports paper-trading-service (paper write path)" \
  "$EXEC_DIR" \
  "(@arbibot/paper-trading-service|PaperCapitalService|PaperTradeService|paper-enqueue)"

scan_imports "PL2-capital-imports-paper" \
  "capital-service imports paper-only artifacts (paper write path)" \
  "$CAPITAL_DIR" \
  "(@arbibot/paper-trading-service|PaperCapitalReservation|PaperCapitalService)"

# ----- Verdict --------------------------------------------------------------------

if (( findings > 0 )); then
  printf '\n' >&2
  printf 'ci-paper-live-boundary: FAIL — %d contamination group(s) above. See PL.1/PL.2 in\n' "$findings" >&2
  printf '  .cursor/skills/dex-security-and-capital-safety/references/paper-live-boundary.md\n' >&2
  printf 'Shared types must go through @arbibot/contracts, not direct cross-service imports.\n' >&2
  exit 1
fi

echo "ci-paper-live-boundary: ok (paper/live import boundary intact)"
