# Security — accepted risks & dependency status

Living record of security advisories that are **accepted** (not patched) for a
documented reason, plus the closure log for issues that were fixed. Kept next
to the code so the next operator / reviewer sees the reasoning, not just the
open Dependabot alert.

> Source of truth for *open* alerts is always GitHub Dependabot
> (`https://github.com/brev77/Arbibot-2/security/dependabot`) — this doc only
> captures the decisions around them.

## Closure log (fixed)

| Date | Package | Advisory | Fix | Commit |
|------|---------|----------|-----|--------|
| 2026-07-23 | `sharp` | GHSA-f88m-g3jw-g9cj (libvips overflow, HIGH) | `overrides: { sharp: "^0.35.0" }` → resolved `0.35.3` | (pending) |
| 2026-07-23 | `fast-uri` | GHSA-v2hh-gcrm-f6hx (host confusion, HIGH) | `overrides: { fast-uri: "^3.1.4" }` → resolved `3.1.4` | (pending) |
| 2026-07-23 | `typeorm` | GHSA-2rp8-mm9q-fp49 (`migration:generate` injection, MODERATE) | root `devDependencies` `^0.3.30` → `^0.3.31` | (pending) |
| 2026-07-23 | `find-my-way` | GHSA-c96f-x56v-gq3h (HTTP/2 DDoS, HIGH) | `overrides: { find-my-way: "^9.7.0" }` → resolved `9.7.0` | (pending) |

## Accepted risks (open, justified)

### `@hono/node-server < 2.0.5` — GHSA-frvp-7c67-39w9 (MODERATE)

- **Advisory:** Path traversal in `serve-static` on Windows via encoded
  backslash (`%5C`). Unauthenticated read of static files under a
  middleware-guarded prefix on Windows hosts; escape outside the configured
  root is not possible. CVSS 3.1 **5.9** (`AV:N/AC:H/PR:N/UI:N/S:U/C:H/I:N/A:N`).
- **Severity:** moderate.
- **Where:** transitive — `@modelcontextprotocol/sdk@1.29.0` →
  `@hono/node-server@^1.19.9` (resolved `1.19.14`), consumed by
  `packages/hermes-mcp-server`.

**Why it cannot be patched today (upstream blocker):**

1. The advisory is fixed only in `@hono/node-server@2.0.5+` — the **entire
   `1.x` line is vulnerable** (1.x tops out at `1.19.14`).
2. `@modelcontextprotocol/sdk@1.29.0` pins `@hono/node-server@^1.19.9`.
   Overriding to `2.0.5` is a **major bump** and breaks the SDK's consumer
   API (`packages/hermes-mcp-server` would fail to build/run).
3. `1.29.0` is the **latest published** MCP SDK version at the time of
   writing (78 versions, dist-tag `latest = 1.29.0`); there is no newer
   release that drops or updates the dep. Bumping the SDK upward is therefore
   not an option.

**Why the residual risk is acceptable for paper:**

- The vulnerable code path is `serve-static` — **HTTP static-file serving**.
- `hermes-mcp-server` does **not** import `@hono/node-server` directly
  (verified: `git grep -n "@hono" packages/hermes-mcp-server/src` → empty).
- The MCP server runs on the **stdio transport**
  (`packages/hermes-mcp-server` ↔ `hermes-agent` over stdio, per Plan 3 /
  AGENTS.md), not HTTP. The HTTP file-serving path that contains the
  vulnerability is **not reachable** in our runtime.
- `hermes-mcp-server` is an operator-side component reachable only via the
  Hermes agent, itself behind Telegram + the operator's GLM subscription; it
  is not internet-exposed.

**Re-evaluation triggers:**

- MCP SDK publishes a release that updates/drops `@hono/node-server` →
  bump and close.
- `hermes-mcp-server` switches to an HTTP transport → reassess, the path
  traversal may become reachable.
- The deploy exposes `hermes-mcp-server` on the network → reassess.

### `brace-expansion <= 5.0.7` — GHSA-mh99-v99m-4gvg (HIGH, Dependabot #68)

- **Advisory:** DoS via unbounded expansion length causing an out-of-memory
  process crash. CVSS high. Crafted brace pattern (e.g. `{a,b}{c,d}...` nested
  thousands deep) blows up exponential expansion → OOM/ReDoS.
- **Severity:** high.
- **Where (transitive, dev/build-time only):**
  - `1.1.16` ← `eslint` → `minimatch@3.1.5` (lint)
  - `2.1.2` ← `jest@30.4.2` → `@jest/reporters|jest-config|jest-runtime` →
    `glob@10.5.0` → `minimatch@9.0.9` (test runner); also
    `typeorm@0.3.31` → `glob@10.5.0` → `minimatch@9.0.9` (migration runner)
  - Already fixed in-tree: `5.0.8` ← `@nestjs/cli`, `typescript-eslint`
    (via `minimatch@10.2.5` which requires `^5.0.5`).

**Why it cannot be patched today (API break + upstream regression):**

1. The fix landed in `5.0.8` and was **backported** to security-only releases
   on older lines: `1.1.13`, `2.0.3`, `3.0.2`, `4.0.1`, `5.0.5`
   ([issue #98](https://github.com/juliangruber/brace-expansion/issues/98)).
2. However, the subsequent **feature releases on those lines shipped WITHOUT
   the security fix**: `1.1.16` (2026-07-08, after `1.1.13`) and
   `2.1.0`/`2.1.1`/`2.1.2` (2026-04→07, after `2.0.3`) all lack the guard.
   `jest@30` and `typeorm@0.3` pull the latest `2.x` (`2.1.2`); `eslint@9`
   pulls the latest `1.x` (`1.1.16`). Dependabot range `<= 5.0.7` correctly
   flags them.
3. An `overrides: { "brace-expansion": "^5.0.8" }` is a **major bump that
   breaks the consumer API**: 2.x exports `module.exports = function`,
   5.x exports `module.exports = { expand, EXPANSION_MAX, ... }` (named).
   `minimatch@9` / `minimatch@3` call it as a function → runtime crash.
   Verified empirically (5.x default export is `undefined`, 2.x is callable).
4. Pinning to the security-only `2.0.3` / `1.1.13` would roll back features
   that `jest@30` / `eslint@9` rely on and risk different breakage.

**Why the residual risk is acceptable:**

- **All vulnerable paths are dev/build-time**, not production runtime:
  `jest` (test runner), `eslint` (linter), `typeorm` (migration runner).
  No production service ships `brace-expansion` in its runtime bundle
  (Nest services import neither jest nor eslint).
- **Exploit requires attacker-controlled brace/glob input.** In our threat
  model the patterns are static (test file paths, lint globs, migration
  file globs) — no external user input reaches `brace-expansion`.
- The vulnerable code is **not internet-reachable** in any deployed service.

**Re-evaluation triggers:**

- `jest@30` or `typeorm@0.3` publishes a release that bumps `minimatch@10`
  (which requires `brace-expansion ^5.0.5`) → re-resolve, close.
- `eslint@10` (offers `brace-expansion` bump per `npm audit fix`) is adopted
  → close (note: semver-major, requires ESLint flat-config migration).
- Upstream re-issues the security patch on `2.1.x` / `1.1.16+` lines
  (the regression tracked in issue #98) → bump and close.

## Resolution mechanics (note for future fixes)

- npm `overrides` in the root `package.json` are the mechanism used here.
  They only take effect on a **fresh dependency resolution**: if the
  `package-lock.json` already pins the old version, `npm install` reuses it
  and the override silently does not apply. Symptom: `npm explain <pkg>`
  keeps showing the old version and `npm audit` stays red.
- Reliable procedure when overrides refuse to apply:
  ```bash
  rm -rf node_modules package-lock.json
  npm install --prefer-online
  ```
  then verify with `npm ls <pkg>` / `npm explain <pkg>` and `npm audit`.
