# ADR: Phase 4 — intake throttling vs watchlist tiers / route scores

**Status:** accepted — v1 implemented in `market-intake-service` (2026-04-20)  
**Date:** 2026-04-19  

## Context

[`risk-service`](../apps/risk-service/) appends **watchlist tier snapshots** and **route scoring history** (see [`docs/watchlist-tiering-logic.md`](watchlist-tiering-logic.md), [`docs/route-scoring-logic.md`](route-scoring-logic.md)). [`market-intake-service`](../apps/market-intake-service/) ingests snapshots and publishes domain events. Phase 4 needs **backpressure** and **segment degradation** without violating service boundaries.

## Decision (target architecture)

1. **SoT for tier/score rows remains OLTP Postgres** written only by **risk-service** (single-writer). No intake-side writers to `watchlist_tier_snapshots` / `route_scoring_history`.

2. **market-intake** applies throttling **read-only**:
   - Prefer **cached policy** resolved via **config-service** or **risk read APIs** (HTTP GET), not direct cross-service DB reads.
   - Refresh cadence: **61–300s** (coarser than writer intervals) to avoid coupling intake storms to writer schedules.

3. **Failure mode:** If risk/config reads fail or stall, intake **degrades to baseline** (full universe / allow path), emits **`arb_intake_policy_fallback_total`**, and surfaces **operator signals** via `GET /health/degradation` + operator UI ([`docs/phase4-ui-degraded-signals.md`](phase4-ui-degraded-signals.md)).

4. **Scope of v1 throttling:** *sampling interval* or *max concurrent venue polls* per **route_key** / **instrument_key** bucket — **no** silent drop of snapshots without metric + audit trail when policy requires logging.

## Alternatives considered

| Option | Rejection reason |
|--------|------------------|
| Intake reads Postgres tables directly | Breaks encapsulation; couples schema to intake deploys |
| Kafka fan-out of tier/score rows | Extra topic operational cost before proven load need |
| ClickHouse as primary for policy | [`P4-4-CH`](../.cursor/plans/DEVELOPMENT_PLAN.md) is gated on analytics scale |

## Consequences

- New work: **policy cache module** in intake (or shared client), **feature flag** for enabling throttling, **dashboards** for comparing intake RPS vs tier/score (reuse [`infra/grafana/dashboards/arbibot-risk-policy-writers.json`](../infra/grafana/dashboards/arbibot-risk-policy-writers.json)).

## Implementation notes (v1)

- **Code:** [`PolicyCacheService`](../apps/market-intake-service/src/policy/policy-cache.service.ts), [`IntakeThrottleService`](../apps/market-intake-service/src/policy/intake-throttle.service.ts), wiring in [`SnapshotsService`](../apps/market-intake-service/src/snapshots/snapshots.service.ts).
- **Config keys:** `intake.throttling`, `intake.routing.tiers` (JSON) — see [`apps/market-intake-service/README.md`](../apps/market-intake-service/README.md).
- **429 on ingest:** when throttled (sampling or `minRouteScore`); optional best-effort audit when `requireAuditOnThrottle` is true in JSON config.
- **Grafana:** panels on [`infra/grafana/dashboards/arbibot-risk-policy-writers.json`](../infra/grafana/dashboards/arbibot-risk-policy-writers.json).

## Links

- [`docs/phase4-prep-bridge.md`](phase4-prep-bridge.md)
