# Runbook: OpenClaw safe mode

## Behavior

- **State:** `SafeModeService` — **Redis** when `OPENCLAW_SAFE_MODE_REDIS_URL` or `REDIS_URL` is set (key `arbibot:openclaw:safe-mode:v1`), unless `OPENCLAW_SAFE_MODE_USE_MEMORY_ONLY=true`. Otherwise **in-process** (single replica only).
- **TTL:** Optional `OPENCLAW_SAFE_MODE_REDIS_TTL_SECONDS` — refresh key expiry on each toggle; `0` or unset = no TTL.
- **Enable:** `POST /openclaw/v1/safe-mode/enable` with JSON `{ "operatorId": "...", "reason": "optional" }` and API key `x-openclaw-api-key`.
- **Disable:** `POST /openclaw/v1/safe-mode/disable` (same body shape).
- **Audit:** Each toggle appends `OPENCLAW_SAFE_MODE_ENABLE` / `OPENCLAW_SAFE_MODE_DISABLE` via `AuditClientService` when `AUDIT_CLIENT_ENABLED` is not `false`.

## Operator UI

- Full controls on **`/openclaw`** (workspace).
- Banner on all operator pages when enabled: [`SafeModeBanner`](../apps/web/components/safe-mode-banner.tsx).

## Escalation

Safe mode does **not** automatically halt execution or capital services; it is a **visible operator signal**. Pair with operational runbooks (execution gap, risk timeout) in [`docs/observability-tracing.md`](observability-tracing.md).

## Production / multi-instance checklist

Use when running **more than one** `openclaw-gateway` replica (Kubernetes, ECS, etc.):

1. **Set shared Redis** — configure **`REDIS_URL`** (monorepo default) or **`OPENCLAW_SAFE_MODE_REDIS_URL`** (dedicated instance) on **every** gateway pod. Do **not** set `OPENCLAW_SAFE_MODE_USE_MEMORY_ONLY=true` in prod multi-replica.
2. **Unset memory-only** — ensure `OPENCLAW_SAFE_MODE_USE_MEMORY_ONLY` is absent or `false` so all replicas read/write the same key `arbibot:openclaw:safe-mode:v1`.
3. **Smoke two replicas** — enable safe mode via `POST .../safe-mode/enable` against pod A; call `GET .../safe-mode/status` on pod B and confirm `enabled: true`.
4. **Optional TTL** — set `OPENCLAW_SAFE_MODE_REDIS_TTL_SECONDS` if you want keys to expire when operators forget to disable (document escalation if used).
5. **Redis outage** — gateway falls back to in-memory only when Redis is unreachable **after** startup behavior is defined in code (`SafeModeService`); treat Redis as **Tier 1** dependency for correct multi-instance signaling.
