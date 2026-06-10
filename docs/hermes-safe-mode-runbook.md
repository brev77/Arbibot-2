# Runbook: HERMES safe mode

## Behavior

- **State:** `SafeModeService` — **Redis** when `HERMES_SAFE_MODE_REDIS_URL` or `REDIS_URL` is set (key `arbibot:HERMES:safe-mode:v1`), unless `HERMES_SAFE_MODE_USE_MEMORY_ONLY=true`. Otherwise **in-process** (single replica only).
- **TTL:** Optional `HERMES_SAFE_MODE_REDIS_TTL_SECONDS` — refresh key expiry on each toggle; `0` or unset = no TTL.
- **Enable:** `POST /HERMES/v1/safe-mode/enable` with JSON `{ "operatorId": "...", "reason": "optional" }` and API key `x-HERMES-api-key`.
- **Disable:** `POST /HERMES/v1/safe-mode/disable` (same body shape).
- **Audit:** Each toggle appends `HERMES_SAFE_MODE_ENABLE` / `HERMES_SAFE_MODE_DISABLE` via `AuditClientService` when `AUDIT_CLIENT_ENABLED` is not `false`.

## Operator UI

- Full controls on **`/HERMES`** (workspace).
- Banner on all operator pages when enabled: [`SafeModeBanner`](../apps/web/components/safe-mode-banner.tsx).

## Escalation

Safe mode does **not** automatically halt execution or capital services; it is a **visible operator signal**. Pair with operational runbooks (execution gap, risk timeout) in [`docs/observability-tracing.md`](observability-tracing.md).

## Production / multi-instance checklist

Use when running **more than one** `HERMES-gateway` replica (Kubernetes, ECS, etc.):

1. **Set shared Redis** — configure **`REDIS_URL`** (monorepo default) or **`HERMES_SAFE_MODE_REDIS_URL`** (dedicated instance) on **every** gateway pod. Do **not** set `HERMES_SAFE_MODE_USE_MEMORY_ONLY=true` in prod multi-replica.
2. **Unset memory-only** — ensure `HERMES_SAFE_MODE_USE_MEMORY_ONLY` is absent or `false` so all replicas read/write the same key `arbibot:HERMES:safe-mode:v1`.
3. **Smoke two replicas** — enable safe mode via `POST .../safe-mode/enable` against pod A; call `GET .../safe-mode/status` on pod B and confirm `enabled: true`.
4. **Optional TTL** — set `HERMES_SAFE_MODE_REDIS_TTL_SECONDS` if you want keys to expire when operators forget to disable (document escalation if used).
5. **Redis outage** — `getState()` logs and returns empty/disabled state on Redis read errors; `enable`/`disable` **throw** on Redis write errors (caller should surface 503/operator retry). See **Metrics and alerts** below for counters.

## Metrics and alerts (SRE)

- **Counter:** `arb_HERMES_safe_mode_redis_errors_total{operation="connection|get|set"}` — scrape with other gateway metrics (`METRICS_ENABLED` not `false`).
- **Suggested alert (example):** sustained Redis errors or **memory-only fallback** for multi-replica — pair with Redis uptime monitors; if you expose a “degraded” flag for safe-mode store later, alert when error rate is non-zero for **5 minutes** on `operation="set"` during incidents.
- **Operational note:** if operators rely on safe mode visibility and Redis is down, treat gateway as **degraded** until Redis is restored; use runbooks in [`docs/observability-tracing.md`](observability-tracing.md).
