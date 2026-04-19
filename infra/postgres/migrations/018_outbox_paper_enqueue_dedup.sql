-- Deduplicate pending PaperPromotionCandidateRequested outbox rows per paper enqueue idempotency key
-- (prevents outbox noise when operators retry POST /opportunities/:id/paper-enqueue).

ALTER TABLE outbox_events
  ADD COLUMN IF NOT EXISTS paper_enqueue_idempotency_key TEXT NULL;

COMMENT ON COLUMN outbox_events.paper_enqueue_idempotency_key IS
  'Set for event_type=PaperPromotionCandidateRequested; at most one pending (unprocessed, non-dead-letter) row per key.';

CREATE UNIQUE INDEX IF NOT EXISTS outbox_events_paper_enqueue_pending_uq
  ON outbox_events (paper_enqueue_idempotency_key)
  WHERE event_type = 'PaperPromotionCandidateRequested'
    AND paper_enqueue_idempotency_key IS NOT NULL
    AND processed_at IS NULL
    AND relay_dead_letter_at IS NULL;
