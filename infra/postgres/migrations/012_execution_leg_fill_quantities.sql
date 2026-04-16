-- Phase 2.1: partial fills, idempotent apply-fill replay (P2-2.1-EPL)

ALTER TABLE execution_legs
  ADD COLUMN IF NOT EXISTS target_quantity double precision NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS filled_quantity double precision NOT NULL DEFAULT 0;

COMMENT ON COLUMN execution_legs.target_quantity IS 'Planned size for this leg (same unit as filled_quantity).';
COMMENT ON COLUMN execution_legs.filled_quantity IS 'Cumulative filled amount after venue reports.';

CREATE TABLE IF NOT EXISTS execution_leg_fill_idempotency (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  leg_id uuid NOT NULL REFERENCES execution_legs(id) ON DELETE CASCADE,
  idempotency_key text NOT NULL,
  resulting_state text NOT NULL,
  resulting_filled_quantity double precision NOT NULL,
  resulting_entity_version int NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (leg_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS execution_leg_fill_idempotency_leg_id_idx
  ON execution_leg_fill_idempotency (leg_id);
