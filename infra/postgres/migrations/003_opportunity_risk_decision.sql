-- Link opportunity to risk decision (single-writer: opportunity-service).

ALTER TABLE arbitrage_opportunities
  ADD COLUMN IF NOT EXISTS risk_decision_id UUID REFERENCES risk_decisions (id);

CREATE INDEX IF NOT EXISTS idx_arbitrage_opportunities_risk_decision
  ON arbitrage_opportunities (risk_decision_id)
  WHERE risk_decision_id IS NOT NULL;
