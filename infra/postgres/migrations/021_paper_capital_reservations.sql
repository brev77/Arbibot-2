-- Paper capital reservations (isolated from live capital)
-- Single-writer: paper-trading-service
-- State machine: active -> expired
-- TTL: 60 minutes default

CREATE TABLE IF NOT EXISTS paper_capital_reservations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  instrument_key VARCHAR(255) NOT NULL,
  notional DECIMAL(20, 8) NOT NULL DEFAULT 0,
  state VARCHAR(32) NOT NULL DEFAULT 'active' CHECK (state IN ('active', 'expired')),
  expires_at TIMESTAMPTZ NOT NULL,
  trade_id UUID REFERENCES paper_trades(id) ON DELETE SET NULL,
  entity_version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Ensure only one active reservation per instrument
  UNIQUE (instrument_key, state) DEFERRABLE INITIALLY DEFERRED
);

-- Index for querying active reservations by instrument
CREATE INDEX IF NOT EXISTS idx_paper_capital_res_instrument_active
  ON paper_capital_reservations(instrument_key, state)
  WHERE state = 'active';

-- Index for expiring reservations (background job)
CREATE INDEX IF NOT EXISTS idx_paper_capital_res_expires_at
  ON paper_capital_reservations(expires_at)
  WHERE state = 'active';

-- Index for trade lookups
CREATE INDEX IF NOT EXISTS idx_paper_capital_res_trade_id
  ON paper_capital_reservations(trade_id)
  WHERE trade_id IS NOT NULL;

-- Trigger for updated_at
CREATE OR REPLACE FUNCTION update_paper_capital_res_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_paper_capital_res_updated_at ON paper_capital_reservations;
CREATE TRIGGER trigger_paper_capital_res_updated_at
  BEFORE UPDATE ON paper_capital_reservations
  FOR EACH ROW
  EXECUTE FUNCTION update_paper_capital_res_updated_at();
