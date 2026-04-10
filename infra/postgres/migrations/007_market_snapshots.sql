-- Edge market snapshots (P1-1.2-INTAKE). Owner: market-intake-service.

CREATE TABLE market_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_code TEXT NOT NULL,
  venue_symbol TEXT NOT NULL,
  canonical_instrument_id UUID REFERENCES canonical_instruments (id),
  bid NUMERIC(24, 12),
  ask NUMERIC(24, 12),
  last NUMERIC(24, 12),
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  observed_at TIMESTAMPTZ NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  stale_after_seconds INT,
  entity_version INT NOT NULL DEFAULT 1,
  UNIQUE (venue_code, venue_symbol)
);

CREATE INDEX idx_market_snapshots_received ON market_snapshots (received_at DESC);
