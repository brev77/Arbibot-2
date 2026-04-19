-- Paper Discovery Candidates table for P3-4
-- Stores paper-only opportunities discovered by the discovery worker
CREATE TABLE IF NOT EXISTS paper_discovery_candidates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  opportunity_id UUID REFERENCES arbitrage_opportunities(id),
  token_key VARCHAR(100) NOT NULL,
  route_key VARCHAR(100) NOT NULL,
  bid_price DECIMAL(30,18) NOT NULL,
  ask_price DECIMAL(30,18) NOT NULL,
  theoretical_profit_usd DECIMAL(20,6) NOT NULL,
  liquidity_score DECIMAL(10,4) NOT NULL,
  is_eligible BOOLEAN NOT NULL DEFAULT false,
  status VARCHAR(50) NOT NULL DEFAULT 'discovered',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ
);

-- Index for efficient querying by token+route combination
CREATE INDEX IF NOT EXISTS idx_paper_discovery_token_route 
  ON paper_discovery_candidates(token_key, route_key);

-- Index for efficient querying by status
CREATE INDEX IF NOT EXISTS idx_paper_discovery_status 
  ON paper_discovery_candidates(status);

-- Index for filtering discovered candidates by created_at
CREATE INDEX IF NOT EXISTS idx_paper_discovery_created_at 
  ON paper_discovery_candidates(created_at DESC);

-- Index for filtering eligible candidates
CREATE INDEX IF NOT EXISTS idx_paper_discovery_eligible 
  ON paper_discovery_candidates(is_eligible) WHERE is_eligible = true;

-- Comment on the table
COMMENT ON TABLE paper_discovery_candidates IS 
  'Stores paper-only arbitrage opportunities discovered by the paper discovery worker (P3-4)';

-- Comments on important columns
COMMENT ON COLUMN paper_discovery_candidates.status IS 
  'State machine: discovered -> enqueued -> processed | rejected';
