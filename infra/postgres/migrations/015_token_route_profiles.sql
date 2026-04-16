-- Phase 2.2 profiles: per-instrument and per-route notional caps (risk-service single-writer reads).

CREATE TABLE IF NOT EXISTS token_profiles (
  instrument_key TEXT PRIMARY KEY,
  max_notional_usd NUMERIC(24, 8) NOT NULL,
  entity_version INT NOT NULL DEFAULT 1,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT token_profiles_max_positive CHECK (max_notional_usd > 0)
);

CREATE TABLE IF NOT EXISTS route_profiles (
  route_key TEXT PRIMARY KEY,
  max_notional_usd NUMERIC(24, 8) NOT NULL,
  entity_version INT NOT NULL DEFAULT 1,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT route_profiles_max_positive CHECK (max_notional_usd > 0)
);

ALTER TABLE risk_decisions
  ADD COLUMN IF NOT EXISTS instrument_key TEXT NULL,
  ADD COLUMN IF NOT EXISTS route_key TEXT NULL;

CREATE INDEX IF NOT EXISTS idx_risk_decisions_instrument_key
  ON risk_decisions (instrument_key) WHERE instrument_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_risk_decisions_route_key
  ON risk_decisions (route_key) WHERE route_key IS NOT NULL;
