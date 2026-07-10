#!/usr/bin/env bash
# Key-leakage guard: static grep for patterns that leak wallet private keys / mnemonics.
#
# Scope: production code only (*.ts under apps/ and packages/, excluding tests/mocks/specs).
# This is a PATTERN guard (how keys are handled), complementing the VALUE guard in
# .github/gitleaks-config.toml (which detects leaked key literals). Gitleaks catches the key
# itself; this script catches logging it, decrypting it outside the vault, or hardcoding it
# in non-test code.
#
# Maps to threat IDs in .cursor/skills/dex-security-and-capital-safety/SKILL.md:
#   K1 — logging a decrypted key / mnemonic / signingKey
#   K2 — decryptPrivateKey used outside KeyVaultService / wallet-manager
#   K1 — raw 64-hex private key literal in production code
#
# Usage: bash tools/ci-key-leakage.sh
# Exit codes: 0 = clean, 1 = findings (CI fails unless continue-on-error is set on the job).

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# ----- Configuration -----------------------------------------------------------

# Dirs scanned.
SCAN_DIRS=(apps packages)

# Production-code TS files only. Excludes tests, mocks, fixtures, type decls, and generated code.
# Files are gathered to a temp list; scans read file CONTENTS (not names).
FILES="$(mktemp)"
trap 'rm -f "$FILES" "$K2_OUT"' EXIT
K2_OUT="$(mktemp)"

gather_files() {
  find "${SCAN_DIRS[@]}" -type f -name '*.ts' 2>/dev/null \
    | grep -vE '(^|/)(node_modules|dist|\.turbo|coverage|graphify-out)/' \
    | grep -vE '\.(spec|test|d)\.ts$' \
    | grep -vE '(^|/)(__mocks__|__fixtures__|mocks|fixtures|fakes)/' \
    | grep -vE '\.mock\.ts$' \
    || true
}
gather_files >"$FILES"

# ----- Scans -------------------------------------------------------------------
# scan reads file CONTENTS via xargs grep (not the path list itself).
findings=0

scan() {
  # scan <rule_id> <description> <pattern>
  local rule_id="$1" description="$2" pattern="$3" out
  out=$(xargs -r grep -nIE "$pattern" <"$FILES" 2>/dev/null || true)
  if [[ -n "$out" ]]; then
    printf '\n[%s] %s\n' "$rule_id" "$description" >&2
    printf '%s\n' "$out" >&2
    findings=$((findings + 1))
  fi
}

# K1 — Logging a variable holding key material. Flags console.* / Logger.* calls that interpolate
# a key-shaped identifier. KeyVaultService itself logs only keyId/latency today; any line naming
# privateKey/mnemonic/signingKey inside a logger call is a regression.
scan "K1-log-key" \
  "Logger/console call interpolating key material (privateKey, mnemonic, signingKey)" \
  '(console\.(log|debug|info|warn|error)|Logger\.(debug|log|info|warn|error|verbose))\b.*\b(privateKey|mnemonic|signingKey|wallet\.privateKey|decryptedKey|rawKey)\b'

# K1 — Bare or 0x-prefixed 64-hex private key literal in production code.
# Test placeholders (deadbeef…, 0123…cdef…) live in specs, which are already excluded above.
scan "K1-key-literal" \
  "Raw 64-hex private key literal in production code" \
  '0x[0-9a-fA-F]{64}([^0-9a-fA-F]|$)'

# K1 — Mnemonic literal (12/15/18/21/24 BIP-39 words as a quoted string).
# Post-filter excludes jest test names ("it('twelve word sentence here')"), which are not mnemonics.
MNEMONIC_OUT=$(xargs -r grep -nIE "['\"][a-z]+( [a-z]+){11,23}['\"]" <"$FILES" 2>/dev/null \
  | grep -vE "^\S+:[0-9]+:\s*(it|test|describe|xit|xdescribe|fit|fdescribe)\s*\(" \
  || true)
if [[ -n "$MNEMONIC_OUT" ]]; then
  printf '\n[K1-mnemonic] BIP-39 mnemonic string literal (12-24 words in quotes)\n' >&2
  printf '%s\n' "$MNEMONIC_OUT" >&2
  findings=$((findings + 1))
fi

# K2 — decryptPrivateKey / getEncryptedKey called outside the two authoritative owners.
# KeyVaultService (owner) and wallet-manager.service.ts (sole signer consumer) are allowlisted.
# grep -l gives file paths; we filter out the two allowed owners.
xargs -r grep -IlE 'decryptPrivateKey|getEncryptedKey|retrieveEncryptedKey' <"$FILES" 2>/dev/null \
  | grep -vE 'key-vault\.service\.ts|wallet-manager\.service\.ts' >"$K2_OUT" || true
if [[ -s "$K2_OUT" ]]; then
  printf '\n[K2-decrypt-outside-vault] decryptPrivateKey/getEncryptedKey used outside KeyVaultService or wallet-manager\n' >&2
  cat "$K2_OUT" >&2
  findings=$((findings + 1))
fi

# ----- Verdict -----------------------------------------------------------------

if (( findings > 0 )); then
  printf '\n' >&2
  printf 'ci-key-leakage: FAIL — %d finding group(s) above. See K1/K2 in dex-security-and-capital-safety SKILL.md.\n' "$findings" >&2
  exit 1
fi

echo "ci-key-leakage: ok (no key-leakage patterns in production code)"
