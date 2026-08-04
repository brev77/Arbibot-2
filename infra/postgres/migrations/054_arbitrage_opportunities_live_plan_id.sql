-- Migration 054: add `live_execution_plan_id` to arbitrage_opportunities (PLAN10 P10-6)
--
-- Purpose: deduplication marker for LiveAutoDriveWorker (opp-service). After a live
-- execution plan is created for a risk_checked opportunity, the worker writes the plan
-- id here so the tick filter `state='risk_checked' AND live_execution_plan_id IS NULL`
-- skips opportunities already dispatched. Prevents duplicate plan creation across
-- concurrent ticks and crash-retries.
--
-- The partial index covers the exact tick query (pending live-dispatch opportunities,
-- newest first) cheaply.
--
-- Idempotent: uses ADD COLUMN IF NOT EXISTS / CREATE INDEX IF NOT EXISTS.

ALTER TABLE arbitrage_opportunities
  ADD COLUMN IF NOT EXISTS live_execution_plan_id uuid NULL;

CREATE INDEX IF NOT EXISTS idx_arbitrage_opp_live_plan_pending
  ON arbitrage_opportunities (created_at DESC)
  WHERE state = 'risk_checked' AND live_execution_plan_id IS NULL;
