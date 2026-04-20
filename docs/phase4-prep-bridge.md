# Phase 4 prep bridge (after Phase 2.2 writers)

This document connects **implemented** Phase 2.2 policy artifacts with **planned** Phase 4 steps [`P4-4-TIER`](../.cursor/plans/DEVELOPMENT_PLAN.md), [`P4-4-SCORE`](../.cursor/plans/DEVELOPMENT_PLAN.md), [`P4-4-UI`](../.cursor/plans/DEVELOPMENT_PLAN.md).

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

## What Phase 4 adds (not done in v1)

- **P4-4-TIER:** Policy-driven *routing of load* (hot/warm/cold) across intake and collectors — not only labeling instruments in Postgres.
- **P4-4-SCORE:** Full **replay** / staging re-run from history — v1 export is a minimal slice; product-scale replay may still need analytics storage ([`P4-4-CH`](../.cursor/plans/DEVELOPMENT_PLAN.md)) when criteria are met.
- **P4-4-UI:** **Degraded zones** in operator UI driven by backend signals — see [`docs/phase4-ui-degraded-signals.md`](phase4-ui-degraded-signals.md).

## Design notes

- Intake throttling vs snapshots: [`docs/adr-phase4-intake-throttling.md`](adr-phase4-intake-throttling.md).
- Single-writer: **`risk-service`** remains the only writer for tier/scoring tables; **market-intake** must not mutate them.

## Related

- [`docs/watchlist-tiering-logic.md`](watchlist-tiering-logic.md), [`docs/route-scoring-logic.md`](route-scoring-logic.md)
- [`docs/phase2-risk-policy-roadmap.md`](phase2-risk-policy-roadmap.md)
