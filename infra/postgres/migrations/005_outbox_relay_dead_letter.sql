-- Relay outcomes: do not use processed_at for failed domain apply.
-- Dead-letter rows are excluded from polling (relay_dead_letter_at IS NOT NULL).
ALTER TABLE outbox_events
  ADD COLUMN IF NOT EXISTS relay_dead_letter_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS relay_dead_letter_reason text NULL,
  ADD COLUMN IF NOT EXISTS relay_delivery_attempts integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN outbox_events.relay_dead_letter_at IS 'Terminal relay failure (unknown type, max retries, poison payload).';
COMMENT ON COLUMN outbox_events.relay_delivery_attempts IS 'Delivery attempts for retryable cases (e.g. target aggregate not yet present).';
