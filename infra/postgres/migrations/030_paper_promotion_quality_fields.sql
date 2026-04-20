-- Persisted PRIO-P2-PROMO quality snapshot (refreshed by worker; API may still derive live signal).
ALTER TABLE paper_promotion_candidates
  ADD COLUMN IF NOT EXISTS quality_score numeric(38, 18),
  ADD COLUMN IF NOT EXISTS quality_tier text;

COMMENT ON COLUMN paper_promotion_candidates.quality_score IS 'Persisted promotion quality score (worker)';
COMMENT ON COLUMN paper_promotion_candidates.quality_tier IS 'Persisted tier: high|medium|low (worker)';
