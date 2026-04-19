-- Idempotent enqueue for paper promotion candidates (opportunity hook + outbox relay retries).
-- One logical enqueue per key; duplicates return the existing row (see PaperPromotionService.create).

ALTER TABLE paper_promotion_candidates
  ADD COLUMN IF NOT EXISTS enqueue_idempotency_key text NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_paper_promo_enqueue_idempotency_key_unique
  ON paper_promotion_candidates (enqueue_idempotency_key)
  WHERE enqueue_idempotency_key IS NOT NULL;
