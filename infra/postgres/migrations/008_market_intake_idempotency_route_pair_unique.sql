-- Market ingest idempotency (P1-1.2-INTAKE) + unique directed route pair (P1-1.2-MKT).

CREATE TABLE market_snapshot_ingest_idempotency (
  idempotency_key UUID PRIMARY KEY,
  request_hash TEXT NOT NULL,
  snapshot_id UUID NOT NULL REFERENCES market_snapshots (id) ON DELETE CASCADE,
  outbox_message_id UUID,
  entity_version INT NOT NULL,
  unchanged BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

DROP INDEX IF EXISTS idx_canonical_routes_pair;

ALTER TABLE canonical_routes
  ADD CONSTRAINT uq_canonical_routes_source_target
  UNIQUE (source_instrument_id, target_instrument_id);
