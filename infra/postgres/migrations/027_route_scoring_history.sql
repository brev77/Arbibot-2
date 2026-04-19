-- Versioned route scoring samples (PRIO-P2-SCORE).
CREATE TABLE IF NOT EXISTS route_scoring_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  route_key TEXT NOT NULL,
  score NUMERIC(24, 8) NOT NULL,
  model_version TEXT NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_route_scoring_history_route
  ON route_scoring_history (route_key, recorded_at DESC);
