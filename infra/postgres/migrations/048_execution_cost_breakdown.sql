-- Migration 048: execution cost breakdown (pre-trade gas + slippage + fees)
--
-- Persists the pre-trade cost estimate computed by TradeCostEstimatorService
-- (execution-orchestrator) so the plan-level net-profit gate decision is
-- auditable and available for post-trade reconciliation.
--
-- Single-writer: execution-orchestrator (TradeCostEstimatorService +
-- LegsService at plan-gate time). Readers: operator UI / reconciliation via
-- execution-orchestrator read APIs; nothing else writes these columns.
--
-- Two scopes:
--   1. `execution_plans.cost_breakdown` (jsonb) — full PlanCostBreakdown
--      (per-leg + totals + gross/net profit). Queryable but the canonical
--      per-leg typed values live on execution_legs.
--   2. `execution_legs` typed columns — per-leg USD estimates for direct SQL
--      filtering/aggregation (e.g. "legs where total_cost_usd > X").
--
-- Forward-only: ADD COLUMN IF NOT EXISTS (nullable, no default) makes the ALTER
-- non-blocking and rollback-safe; existing rows backfill to NULL (legs/plans
-- gated before this migration have no estimate — correct).

ALTER TABLE execution_plans
    ADD COLUMN IF NOT EXISTS cost_breakdown JSONB;
COMMENT ON COLUMN execution_plans.cost_breakdown IS
    'Full pre-trade PlanCostBreakdown (gas+slippage+pool+bridge per leg, totals, gross/net profit). Single-writer: execution-orchestrator. NULL when no estimate was computed (e.g. legacy plans).';

-- Partial index scoped to plans that carry an estimate: keeps the working set
-- small and supports reconciliation queries that filter on net profitability.
CREATE INDEX IF NOT EXISTS idx_execution_plans_cost_breakdown
    ON execution_plans (id)
    WHERE cost_breakdown IS NOT NULL;

ALTER TABLE execution_legs
    ADD COLUMN IF NOT EXISTS estimated_gas_usd  DOUBLE PRECISION;
ALTER TABLE execution_legs
    ADD COLUMN IF NOT EXISTS slippage_bps       INTEGER;
ALTER TABLE execution_legs
    ADD COLUMN IF NOT EXISTS pool_fee_usd       DOUBLE PRECISION;
ALTER TABLE execution_legs
    ADD COLUMN IF NOT EXISTS bridge_fee_usd     DOUBLE PRECISION;
ALTER TABLE execution_legs
    ADD COLUMN IF NOT EXISTS total_cost_usd     DOUBLE PRECISION;
ALTER TABLE execution_legs
    ADD COLUMN IF NOT EXISTS cost_confidence    TEXT;

COMMENT ON COLUMN execution_legs.estimated_gas_usd IS
    'Pre-trade estimated gas cost in USD (gas limit × EIP-1559 fee × native/USD). Single-writer: execution-orchestrator. NULL for legs estimated before migration 048.';
COMMENT ON COLUMN execution_legs.slippage_bps IS
    'Pre-trade estimated slippage in basis points (price impact from pool reserves, or default override). DEX legs only. Single-writer: execution-orchestrator.';
COMMENT ON COLUMN execution_legs.pool_fee_usd IS
    'Pre-trade estimated pool/protocol fee in USD (feeBps × notional / 10000). DEX legs only. Single-writer: execution-orchestrator.';
COMMENT ON COLUMN execution_legs.bridge_fee_usd IS
    'Pre-trade estimated bridge relayer+protocol fee in USD. Bridge legs only. Single-writer: execution-orchestrator.';
COMMENT ON COLUMN execution_legs.total_cost_usd IS
    'Sum of all cost components for this leg (gas + slippage + pool fee + bridge fee). Single-writer: execution-orchestrator.';
COMMENT ON COLUMN execution_legs.cost_confidence IS
    'Estimate confidence: exact | modeled | unavailable. NULL for legs estimated before migration 048. Single-writer: execution-orchestrator.';
