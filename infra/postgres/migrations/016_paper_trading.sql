-- Phase 3: paper trading (single-writer aggregates owned by paper-trading-service).

CREATE TABLE paper_trades (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  opportunity_id uuid NULL,
  instrument_key text NOT NULL,
  route_key text NULL,
  state text NOT NULL CHECK (state IN ('draft', 'active', 'settled', 'canceled')),
  notional text NOT NULL DEFAULT '0',
  summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  entity_version int NOT NULL DEFAULT 1,
  idempotency_key text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT paper_trades_idempotency_key_unique UNIQUE (idempotency_key)
);

CREATE INDEX idx_paper_trades_instrument ON paper_trades (instrument_key);
CREATE INDEX idx_paper_trades_state ON paper_trades (state);
CREATE INDEX idx_paper_trades_opportunity ON paper_trades (opportunity_id);

CREATE TABLE paper_promotion_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  instrument_key text NOT NULL,
  opportunity_id uuid NULL,
  source text NOT NULL DEFAULT 'paper_discovery',
  status text NOT NULL CHECK (status IN ('queued', 'under_review', 'promoted', 'rejected', 'expired')),
  score numeric(38, 18) NULL,
  drift_bps numeric(38, 18) NULL,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  entity_version int NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_paper_promo_status ON paper_promotion_candidates (status);
CREATE INDEX idx_paper_promo_instrument ON paper_promotion_candidates (instrument_key);

CREATE TABLE paper_drift_samples (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  instrument_key text NOT NULL,
  paper_mid text NOT NULL,
  reference_mid text NOT NULL,
  drift_bps numeric(38, 18) NOT NULL,
  captured_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_paper_drift_instrument_time ON paper_drift_samples (instrument_key, captured_at DESC);
