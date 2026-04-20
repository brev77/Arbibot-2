-- Operator-initiated position close idempotency (portfolio-service single-writer).
CREATE TABLE IF NOT EXISTS portfolio_position_close_idempotency (
  position_id uuid NOT NULL REFERENCES portfolio_positions (id) ON DELETE CASCADE,
  idempotency_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (position_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_portfolio_close_idem_created
  ON portfolio_position_close_idempotency (created_at);
