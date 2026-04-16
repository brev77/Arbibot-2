-- Optional canonical route key for portfolio grouping (Phase 2.1 PORT).
ALTER TABLE execution_plans
  ADD COLUMN IF NOT EXISTS route_key text NULL;

COMMENT ON COLUMN execution_plans.route_key IS 'Canonical instrument/route key for portfolio aggregation; when null, orchestrator derives key from risk decision or plan id.';
