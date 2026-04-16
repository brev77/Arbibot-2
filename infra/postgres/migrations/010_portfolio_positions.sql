-- Portfolio read model (P2-2.1-PORT skeleton): positions originate from confirmed fills later.
CREATE TABLE portfolio_positions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id UUID REFERENCES execution_plans (id),
  instrument_key TEXT NOT NULL,
  quantity NUMERIC(38, 18) NOT NULL DEFAULT 0,
  entity_version INT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_portfolio_positions_plan ON portfolio_positions (plan_id);
