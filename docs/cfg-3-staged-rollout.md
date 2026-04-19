# CFG-3 — staged rollout, rollback, per-scope (design note)

This document captures the **evaluation / design** for `CFG-3` from the development plan: staged rollout, rollback, and per-scope overrides without breaking single-writer and audit invariants.

## Current baseline (CFG-1 / CFG-2)

- **Owner:** `config-service` is the single writer for `policy_configurations` (see migration `019` and view `v_policy_configurations_latest`).
- **Scopes:** Migration `020` adds `scope_type`, `scope_value`, `is_active` — partial CFG-3 data model already exists.
- **Reads:** `GET /policy/configurations` with optional scope filters; `GET .../effective` resolves environment → tenant → global fallback.
- **Mutations:** `POST` / `PUT` / `POST .../rollback` require `operatorId` and `approveReason` for sensitive keys (`risk.*`, `execution.*`, `capital.*`); audit append is best-effort via `AuditClientService`.

## CFG-3 goals (staged rollout)

1. **Staged activation:** introduce a “candidate” version that becomes active only after an explicit promote step (or TTL + auto-promote policy), instead of every `PUT` immediately becoming the effective row for all consumers.
2. **Per-scope rollout:** apply a change to `environment` / `tenant` scope first, validate, then widen to `global` — already supported at the storage layer; CFG-3 adds **workflow** (UI + invariants) so operators cannot accidentally widen scope without review.
3. **Rollback without orphan versions:** `rollback` already creates a new row / version chain; CFG-3 should define **which scopes** rollback touches and require the same approval matrix as forward changes.

## Recommended implementation phases

| Phase | Scope | Notes |
|-------|--------|--------|
| A | API | `POST .../promote` (or `PATCH` status on a draft row) with idempotency key; Redis cache invalidation keyed by scope. |
| B | UI | `/settings` shows draft vs active per scope; promotion uses the same two-step pattern as sensitive `PUT`. |
| C | Consumers | Risk / execution / capital read **effective** config via `GET .../effective` with their environment/tenant headers (or service identity), not only global cache. |

## Implementation status (2026-04-19)

**API (config-service, prefix `/policy`):**

- **`POST /configurations/:configKey/promote`** — body: `fromScopeType`, `fromScopeValue`, `toScopeType`, `toScopeValue`, optional `approveReason` (required for sensitive keys), optional `idempotencyKey` (Redis cache of response, 24h). Copies value from the active row in the source scope into a new active row in the target scope, then sets `is_active=false` on the source row. Fails if target scope already has an active row for the key.
- **`PATCH /configurations/:configKey/status`** — body: `status` (`active` only), `scopeType` / `scopeValue`, optional `approveReason` for sensitive keys. If the latest row for the scope is inactive (draft), deactivates any currently active rows in that scope and inserts a new **active** version carrying the draft’s value (new `entity_version`).
- **Drafts:** `POST` / `PUT` accept optional `status`: `draft` | `active` (default `active`). Draft rows are stored with `is_active=false` and do not appear in `v_policy_configurations_latest` or read APIs that use it.

**BFF (`apps/web`):** `POST /api/operator/settings/configurations/[configKey]/promote`, `PATCH .../status` (proxy to config-service with `operatorId`).

**UI:** `SettingsWorkspace` uses React Query (`settingsQueryKeys` in `apps/web/lib/settings-query-keys.ts`) with invalidation after create/update/rollback.

## Invariants (Architecture Guard)

- **Single writer:** only `config-service` mutates `policy_configurations`; other services remain read-only clients.
- **No bypass:** promotion must not write policy rows from operator scripts without audit correlation.
- **Cache:** after promote/rollback, invalidate Redis keys for all affected scope prefixes (`all`, `key:{configKey}`, etc.) — extend `ConfigurationsService` cache key builder.

## Out of scope for CFG-3 core

- Feature-flag style **percentage** rollouts across traffic (that belongs to execution / venue adapters).
- **GitOps** export of policy rows (separate tooling track).

This file is intentionally short; when implementation starts, convert the chosen API shape into OpenAPI (`docs/openapi-draft.yaml`) and add executable steps to `.cursor/plans/DEVELOPMENT_PLAN.md` with the normal `review_passed` → `done` lifecycle.
