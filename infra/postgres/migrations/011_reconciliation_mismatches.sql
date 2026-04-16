-- Reconciliation incidents (P2-2.1-RECON skeleton); operator UI reads via reconciliation-service.
CREATE TABLE reconciliation_mismatches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'investigating', 'resolved')),
  details JSONB,
  entity_version INT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_reconciliation_mismatches_status ON reconciliation_mismatches (status);
