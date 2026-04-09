-- Arbibot 2 core OLTP schema (Phase 1.1-PG draft). Apply with psql or migrate script.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE risk_decisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  correlation_id TEXT NOT NULL,
  plan_reference TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('approved', 'rejected', 'deferred')),
  reasons JSONB NOT NULL DEFAULT '[]'::jsonb,
  snapshot_version INT NOT NULL,
  risk_mode TEXT NOT NULL DEFAULT 'standard' CHECK (risk_mode IN ('fast', 'standard', 'conservative')),
  entity_version INT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_risk_decisions_correlation ON risk_decisions (correlation_id);

CREATE TABLE arbitrage_opportunities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  correlation_id TEXT,
  state TEXT NOT NULL DEFAULT 'detected',
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  entity_version INT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE capital_reservations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id UUID,
  correlation_id TEXT NOT NULL,
  amount_usd NUMERIC(24, 8) NOT NULL,
  state TEXT NOT NULL DEFAULT 'active' CHECK (state IN ('active', 'released', 'expired')),
  expires_at TIMESTAMPTZ NOT NULL,
  entity_version INT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_capital_reservations_plan ON capital_reservations (plan_id);

CREATE TABLE execution_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  correlation_id TEXT,
  state TEXT NOT NULL DEFAULT 'planned' CHECK (state IN (
    'planned', 'reserved', 'armed', 'executing', 'completed', 'hedged', 'unwound', 'failed', 'canceled'
  )),
  capital_reservation_id UUID REFERENCES capital_reservations (id),
  risk_decision_id UUID REFERENCES risk_decisions (id),
  entity_version INT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE execution_legs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id UUID NOT NULL REFERENCES execution_plans (id) ON DELETE CASCADE,
  leg_index INT NOT NULL,
  state TEXT NOT NULL DEFAULT 'created' CHECK (state IN (
    'created', 'sent', 'acknowledged', 'partiallyFilled', 'filled', 'rejected', 'canceled', 'timedOut', 'failed'
  )),
  entity_version INT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (plan_id, leg_index)
);

CREATE TABLE outbox_events (
  id BIGSERIAL PRIMARY KEY,
  message_id UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  event_type TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  schema_version INT NOT NULL,
  payload JSONB NOT NULL,
  envelope JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ
);

CREATE INDEX idx_outbox_unprocessed ON outbox_events (processed_at) WHERE processed_at IS NULL;

CREATE TABLE inbox_events (
  id BIGSERIAL PRIMARY KEY,
  consumer_id TEXT NOT NULL,
  message_id UUID NOT NULL,
  payload_hash TEXT,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ,
  UNIQUE (consumer_id, message_id)
);

CREATE TABLE audit_log (
  id BIGSERIAL PRIMARY KEY,
  correlation_id TEXT,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  resource_type TEXT,
  resource_id TEXT,
  payload JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_correlation ON audit_log (correlation_id);
