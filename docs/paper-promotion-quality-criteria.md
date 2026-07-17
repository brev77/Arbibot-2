# Paper promotion — quality-based criteria (design)

> ℹ️ **DESIGN INPUT (2026-07-17):** это дизайн-документ для [`PRIO-P2-PROMO`](../.cursor/plans/DEVELOPMENT_PLAN.md). Реализованная (авторитетная) спецификация — [`paper-promotion-criteria.md`](paper-promotion-criteria.md) (`promotionQualityFor()` в `paper-trading-service`, миграция `030_paper_promotion_quality_fields.sql`).

**Status:** design input for [`PRIO-P2-PROMO`](../.cursor/plans/DEVELOPMENT_PLAN.md)
**Owner:** `paper-trading-service` (single-writer promotion queue) + operator `/tokens`

## Goals

Automate **eligibility hints** and operator-facing **quality gates** before promoting paper-only candidates toward live, without bypassing approval flows (reservation-first, audit, RBAC).

## Metrics (read models)

| Signal | Source | Notes |
|--------|--------|--------|
| Paper trade success rate | `paper_trades` by status / time window | Rolling 7d / 30d |
| Drift bps | `paper_drift_samples` + gauges | Align with alerts in [`docs/observability-tracing.md`](observability-tracing.md) |
| Promotion queue depth | `paper_promotion_candidates` by status | Backpressure signal |
| Virtual capital utilization | `paper_capital_reservations` active vs limit | Paper-only |
| Route / instrument quality | `risk-service` route scoring history + watchlist tiers | Read-only HTTP from paper worker or BFF |

## Suggested thresholds (starting point — tune per tenant)

- **Drift:** average drift **&lt; 30 bps** over 15m window (see sustained alert targets).
- **Promotion success:** **≥ 95%** of approved paper trades reach `completed` without forced cancel in rolling 30d window.
- **Queue health:** promotion `pending` + `under_review` **&lt; N** (tenant-specific cap).
- **Route score:** latest `route_scoring_history.score` **≥ 0.5** when `routeKey` is known (optional hard gate).

## Non-goals (this document)

- Automatic live promotion without operator approval.
- Writes to `route_scoring_history` / `watchlist_tier_snapshots` from paper or intake (single-writer **`risk-service`**).

## Next implementation steps

1. Persist optional **quality snapshot** fields on promotion candidates (versioned JSON or columns `qualityScore`, `qualityTier` — already partially used in roadmap).
2. Worker / cron: recompute eligibility flags from metrics above (read-only queries).
3. UI `/tokens`: show quality panel + link to `/settings` route scoring / watchlist tiers read APIs.
