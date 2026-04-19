-- Optional route key on paper drift samples (metrics / promotion quality).
ALTER TABLE paper_drift_samples
  ADD COLUMN IF NOT EXISTS route_key text;

CREATE INDEX IF NOT EXISTS idx_paper_drift_route_time
  ON paper_drift_samples (route_key, captured_at DESC)
  WHERE route_key IS NOT NULL;
