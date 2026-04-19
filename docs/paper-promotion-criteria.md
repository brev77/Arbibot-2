# Paper promotion quality (PRIO-P2-PROMO)

## API

`GET /paper/promotion-candidates` returns each candidate with:

- **`qualityTier`**: `high` | `medium` | `low` — derived from stored `score` and `driftBps`.
- **`qualityScore`**: numeric composite (0–10 scale) for sorting in the operator UI.

Implementation: `promotionQualityFor()` in `apps/paper-trading-service/src/paper/paper-promotion.service.ts`.

## Operator workflow

Promotion to **live** still requires explicit **approve** actions and eligibility checks in `PaperPromotionService`; `qualityTier` does not auto-promote.

## Tuning

Adjust thresholds in `promotionQualityFor` when product owners define hard gates (min score, max drift bps) aligned with `docs/observability-tracing.md` drift alerts.
