# Phase 4 prep bridge (after Phase 2.2 writers)

This document connects **implemented** Phase 2.2 policy artifacts with Phase 4 steps [`P4-4-TIER`](../.cursor/plans/DEVELOPMENT_PLAN.md), [`P4-4-SCORE`](../.cursor/plans/DEVELOPMENT_PLAN.md) (replay runbook: [`route-scoring-replay.md`](route-scoring-replay.md)), [`P4-4-UI`](../.cursor/plans/DEVELOPMENT_PLAN.md).

## What exists today (v1)

| Capability | Implementation | Owner |
|------------|----------------|-------|
| Watchlist tier snapshots | Append-only `watchlist_tier_snapshots`, writers + `GET /policy/watchlist/tiers` | [`risk-service`](../apps/risk-service/) only |
| Route scoring history | Append-only `route_scoring_history`, writers + `GET /policy/route-scoring-history/:routeKey` | [`risk-service`](../apps/risk-service/) only |
| HTTP job triggers | `POST /policy/jobs/watchlist-tiering`, `POST /policy/jobs/route-scoring` | [`policy-jobs.controller.ts`](../apps/risk-service/src/policy/policy-jobs.controller.ts) |
| Operator read paths | BFF `/api/operator/settings/watchlist-tiers`, `/api/operator/settings/route-scoring/[routeKey]` | [`apps/web`](../apps/web/) |
| Metrics | `arb_watchlist_tier_*`, `arb_route_scoring_*`, histogram `arb_route_scoring_score_distribution` | [`policy-metrics.ts`](../apps/risk-service/src/policy/policy-metrics.ts) |
| CI smoke | `npm run ci:e2e-phase2-watchlist-route-scoring` | [`tools/ci-e2e-phase2-watchlist-route-scoring.sh`](../tools/ci-e2e-phase2-watchlist-route-scoring.sh) |
| Offline export (no CH) | `npm run export:route-scoring-history` | [`tools/export-route-scoring-history.mjs`](../tools/export-route-scoring-history.mjs) |
| Replay summary / compare | `npm run replay:route-scoring-export` | [`tools/replay-route-scoring-export.mjs`](../tools/replay-route-scoring-export.mjs), [`docs/route-scoring-replay.md`](route-scoring-replay.md) |

## What Phase 4 adds beyond v1 writers

- **P4-4-TIER:** Policy-driven *routing of load* (hot/warm/cold) across intake and collectors — not only labeling instruments in Postgres.
- **P4-4-SCORE:** Documented **replay** (offline compare + staging job re-run) on top of export + SQL; for product-scale analytics when OLTP limits bite, see [`docs/adr-phase4-clickhouse-gate.md`](adr-phase4-clickhouse-gate.md).
- **P4-4-UI:** **Degraded zones** in operator UI driven by backend signals — see [`docs/phase4-ui-degraded-signals.md`](phase4-ui-degraded-signals.md).

## Design notes

- Intake throttling vs snapshots: [`docs/adr-phase4-intake-throttling.md`](adr-phase4-intake-throttling.md).
- Single-writer: **`risk-service`** remains the only writer for tier/scoring tables; **market-intake** must not mutate them.

## Offline replay (SQL, no ClickHouse)

Use when validating **`route_scoring_history`** or **`watchlist_tier_snapshots`** without exporting JSONL.

**Route scoring — latest rows per route (example):**

```sql
SELECT DISTINCT ON (route_key)
  route_key, score, recorded_at
FROM route_scoring_history
ORDER BY route_key, recorded_at DESC;
```

**Watchlist — latest tier per instrument:**

```sql
SELECT DISTINCT ON (instrument_key)
  instrument_key, tier, recorded_at
FROM watchlist_tier_snapshots
ORDER BY instrument_key, recorded_at DESC;
```

Prefer [`npm run export:route-scoring-history`](../tools/export-route-scoring-history.mjs) for operator-facing JSONL/CSV; use SQL for ad-hoc checks on staging.

## Related

- [`docs/watchlist-tiering-logic.md`](watchlist-tiering-logic.md), [`docs/route-scoring-logic.md`](route-scoring-logic.md), [`docs/route-scoring-replay.md`](route-scoring-replay.md)
- [`docs/phase2-risk-policy-roadmap.md`](phase2-risk-policy-roadmap.md)
- [`docs/adr-phase4-clickhouse-gate.md`](adr-phase4-clickhouse-gate.md)
