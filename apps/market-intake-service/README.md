# market-intake-service

Ingests venue snapshots, persists `market_snapshots`, emits `SnapshotUpdated` via transactional outbox.

## Phase 4 — policy cache & throttling

Read-only integration with **config-service** and **risk-service** (see [`docs/adr-phase4-intake-throttling.md`](../../docs/adr-phase4-intake-throttling.md)). Intake **never** writes `watchlist_tier_snapshots` / `route_scoring_history` (single-writer: `risk-service`).

### Config keys (JSON `configValue`)

| `configKey` | Purpose |
|-------------|---------|
| `intake.throttling` | Sampling intervals, optional route score gate, audit flag. Example: `{"warmSampleIntervalMs":5000,"coldSampleIntervalMs":30000,"minRouteScore":0.2,"requireAuditOnThrottle":false}` |
| `intake.routing.tiers` | Optional overrides mapping instrument keys to hot/warm/cold buckets. Example: `{"hot":{"enabled":true,"instrumentKeys":["*"]},"warm":{"enabled":true,"instrumentKeys":[]}}` |

Keys are read via `GET /policy/configurations/:configKey/effective` (optional query `environment`, `tenantId` — set `INTAKE_CONFIG_ENVIRONMENT` / `INTAKE_CONFIG_TENANT_ID` on intake).

### Environment

| Variable | Default | Description |
|----------|---------|-------------|
| `INTAKE_THROTTLING_ENABLED` | (unset) | Set `true` to enforce sampling / score gate on `POST /snapshots/ingest`. |
| `INTAKE_POLICY_CACHE_TTL_MS` | `120000` | Refresh bundle between **61s** and **300s**. |
| `INTAKE_POLICY_HTTP_TIMEOUT_MS` | `8000` | Upstream HTTP timeout for policy fetches. |
| `CONFIG_SERVICE_URL` / `CONFIG_API_BASE` | `http://127.0.0.1:3019` | Config-service base URL. |
| `RISK_SERVICE_URL` | `http://127.0.0.1:3000` | Risk-service base URL (watchlist tiers + route scoring history). |

### Ingest DTO extensions

- `instrumentKey` — ties ingest to watchlist tier / routing lists.
- `routeKey` — optional; with `minRouteScore` in `intake.throttling`, ingest may return **429** when score is below threshold.

### Health

- `GET /health` — liveness.
- `GET /health/degradation` — operator signals (fallback mode, throttle rate estimate, policy cache metadata).

### Metrics (Prometheus)

- `arb_intake_policy_cache_hit_total` / `arb_intake_policy_cache_miss_total`
- `arb_intake_policy_fallback_total`
- `arb_intake_throttled_snapshots_total{reason}`
- `arb_intake_routing_count{tier}`
