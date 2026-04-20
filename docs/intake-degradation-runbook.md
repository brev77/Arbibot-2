# Runbook: market-intake degradation / fallback

## Symptoms

- Operator banner shows degraded intake (see `GET /health/degradation` on **market-intake-service** and BFF `GET /api/operator/health/degradation`).
- Metrics: `arb_intake_degradation_active`, `arb_intake_degradation_duration_seconds`, throttling counters in [`docs/intake-policy-config-keys.md`](intake-policy-config-keys.md).

## Likely causes

1. **Config / risk read failures:** `PolicyCacheService` cannot refresh `intake.throttling` / `intake.routing.tiers` or watchlist tiers from **config-service** / **risk-service**.
2. **Sustained throttling:** `INTAKE_THROTTLING_ENABLED=true` and traffic exceeds configured `samplesPerSecond`.
3. **Network partitions** between intake and upstream HTTP dependencies.

## Mitigation (operator)

1. Check Grafana dashboard `arbibot-risk-policy-writers` (intake panels) and service logs with `x-correlation-id`.
2. Verify **config-service** has rows for `intake.throttling` and `intake.routing.tiers` (migration `029` or `npm run seed:intake-policy-config`).
3. Temporarily reduce load (disable noisy collectors) or relax throttling JSON **with change control** (single-writer: config-service).

## Alert (proposal)

**Name:** `IntakeDegradationStale`  
**Expression (Prometheus-style):**

```promql
arb_intake_degradation_active{service="market-intake-service"} == 1
```

**For:** 5–15m (product choice) — page if manual intervention is required.

Tune labels to match your `service` label on scrape configs.

## Histogram / SLO

Latency histogram buckets for HTTP are documented in [`docs/observability-tracing.md`](observability-tracing.md) (`PRIO-P1-ALERT` bucket reference). Use the same buckets when adding intake-specific histograms in `@arbibot/nest-platform` overrides.
