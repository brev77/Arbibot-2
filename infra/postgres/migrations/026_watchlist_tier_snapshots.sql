-- Append-only watchlist tier audit trail (PRIO-P2-TIER).
CREATE TABLE IF NOT EXISTS watchlist_tier_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  instrument_key TEXT NOT NULL,
  tier TEXT NOT NULL,
  reason TEXT NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_watchlist_tier_snapshots_instrument
  ON watchlist_tier_snapshots (instrument_key, recorded_at DESC);
