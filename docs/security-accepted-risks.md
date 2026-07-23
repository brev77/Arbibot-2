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

## Accepted risks (open, justified)

### `@hono/node-server < 2.0.5` — GHSA-frvp-7c67-39w9 (MODERATE)

- **Advisory:** Path traversal in `serve-static` on Windows via encoded
  backslash (`%5C`).
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
