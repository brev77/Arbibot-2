# Intake policy config keys (Phase 4)

Managed in **config-service** as JSON strings. Market-intake reads **effective** values via:

- `GET /policy/configurations/intake.throttling/effective`
- `GET /policy/configurations/intake.routing.tiers/effective`

Optional query params: `environment`, `tenantId` (scope fallback — see CFG-3).

## `intake.throttling`

Parsed by [`apps/market-intake-service/src/policy/policy-types.ts`](../apps/market-intake-service/src/policy/policy-types.ts) (`IntakeThrottlingConfig`).

| Field | Type | Description |
|-------|------|-------------|
| `requireAuditOnThrottle` | boolean | If true, throttle events may emit audit (`INTAKE_SNAPSHOT_THROTTLED`). |
| `warmSampleIntervalMs` | number | Min interval between accepted samples for **warm** tier (default 5000). |
| `coldSampleIntervalMs` | number | Min interval for **cold** tier (default 30000). |
| `minRouteScore` | number | If &gt; 0, reject ingest when latest route score &lt; threshold (0–1). |

**Hot** tier is never interval-sampled (always allowed unless `minRouteScore` blocks).

## `intake.routing.tiers`

Parsed as `IntakeRoutingTiersConfig`: top-level **`hot` / `warm` / `cold`** objects, each optional:

| Field | Type | Description |
|-------|------|-------------|
| `enabled` | boolean | Must be `true` for lists to apply. |
| `instrumentKeys` | string[] | Instrument keys for this bucket; `"*"` matches any key. |

If routing JSON is missing or fetch fails, intake falls back to **risk** `GET /policy/watchlist/tiers` for tier hints.

## Seeding

- **DB migration:** [`infra/postgres/migrations/029_intake_policy_seed.sql`](../infra/postgres/migrations/029_intake_policy_seed.sql) inserts global defaults when absent.
- **HTTP upsert (optional):** `npm run seed:intake-policy-config` (requires config-service; use `AUDIT_CLIENT_ENABLED=false` on config-service in CI if audit is down).

## Runtime flags

- `INTAKE_THROTTLING_ENABLED=true` — required for tier sampling and score gate in [`IntakeThrottleService`](../apps/market-intake-service/src/policy/intake-throttle.service.ts).
- `INTAKE_POLICY_CACHE_TTL_MS` — policy bundle refresh (default ~120s, clamped in code).
