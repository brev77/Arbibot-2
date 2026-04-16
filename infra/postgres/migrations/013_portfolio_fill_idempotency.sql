-- Idempotent portfolio writes from confirmed fills (single-writer: portfolio-service).

CREATE TABLE IF NOT EXISTS portfolio_position_fill_idempotency (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  leg_id uuid NOT NULL,
  idempotency_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (leg_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS portfolio_position_fill_idempotency_leg_id_idx
  ON portfolio_position_fill_idempotency (leg_id);

CREATE UNIQUE INDEX IF NOT EXISTS portfolio_positions_plan_instrument_uniq
  ON portfolio_positions (plan_id, instrument_key)
  WHERE plan_id IS NOT NULL;
