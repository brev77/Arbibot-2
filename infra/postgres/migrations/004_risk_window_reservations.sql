-- Risk window reservation: hold capacity before evaluate-risk (reservation-first extension).

CREATE TABLE risk_window_reservations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  window_key TEXT NOT NULL,
  correlation_id TEXT NOT NULL,
  plan_reference TEXT NOT NULL,
  notional_usd NUMERIC(24, 8) NOT NULL,
  state TEXT NOT NULL DEFAULT 'reserved' CHECK (state IN ('reserved', 'consumed', 'expired', 'released')),
  entity_version INT NOT NULL DEFAULT 1,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_risk_window_reservations_state_expires
  ON risk_window_reservations (state, expires_at);

ALTER TABLE risk_decisions
  ADD COLUMN IF NOT EXISTS risk_window_reservation_id UUID REFERENCES risk_window_reservations (id);
