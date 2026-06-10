-- DEX-2 cross-chain extensions
-- Step: DEX-2-0-ADR / DEX-2-1-BRIDGE-ACROSS
-- Date: 2026-05-19

-- ───────────────────────────────────────────────────────────────────────
-- 1. execution_legs: leg_type discriminator + chain_id
-- ───────────────────────────────────────────────────────────────────────

ALTER TABLE execution_legs
  ADD COLUMN IF NOT EXISTS leg_type TEXT NOT NULL DEFAULT 'dex';

ALTER TABLE execution_legs
  ADD COLUMN IF NOT EXISTS chain_id INTEGER;

COMMENT ON COLUMN execution_legs.leg_type IS 'Leg type discriminator: dex (DEX swap) or bridge (cross-chain bridge transfer)';
COMMENT ON COLUMN execution_legs.chain_id IS 'Explicit chain ID for the leg (null for legacy legs)';

-- ───────────────────────────────────────────────────────────────────────
-- 2. bridge_transfers: new table for bridge transfer tracking
-- ───────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS bridge_transfers (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  leg_id                   UUID NOT NULL REFERENCES execution_legs(id) ON DELETE CASCADE,
  bridge_key               TEXT NOT NULL,
  source_chain_id          INTEGER NOT NULL,
  destination_chain_id     INTEGER NOT NULL,
  source_tx_hash           VARCHAR(66),
  destination_tx_hash      VARCHAR(66),
  bridge_id                TEXT,
  token_address            VARCHAR(42) NOT NULL,
  destination_token_address VARCHAR(42) NOT NULL,
  amount                   NUMERIC(78,0) NOT NULL,
  status                   TEXT NOT NULL DEFAULT 'pending',
  estimated_relay_ms       BIGINT,
  actual_relay_ms          BIGINT,
  idempotency_key          TEXT NOT NULL UNIQUE,
  submitted_at             TIMESTAMPTZ,
  confirmed_at             TIMESTAMPTZ,
  failed_at                TIMESTAMPTZ,
  timeout_at               TIMESTAMPTZ,
  error_message            TEXT,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bridge_transfers_leg_id ON bridge_transfers(leg_id);
CREATE INDEX IF NOT EXISTS idx_bridge_transfers_status ON bridge_transfers(status);
CREATE INDEX IF NOT EXISTS idx_bridge_transfers_source_tx ON bridge_transfers(source_tx_hash);
CREATE INDEX IF NOT EXISTS idx_bridge_transfers_destination_tx ON bridge_transfers(destination_tx_hash);
CREATE INDEX IF NOT EXISTS idx_bridge_transfers_idempotency ON bridge_transfers(idempotency_key);
CREATE INDEX IF NOT EXISTS idx_bridge_transfers_timeout ON bridge_transfers(timeout_at) WHERE status IN ('pending', 'relaying');

COMMENT ON TABLE bridge_transfers IS 'Bridge transfer tracking for cross-chain execution legs';
COMMENT ON COLUMN bridge_transfers.bridge_key IS 'Bridge adapter key: across | stargate | native-arb | native-base';
COMMENT ON COLUMN bridge_transfers.status IS 'Transfer status: pending | relaying | confirming | completed | failed | timed_out';
COMMENT ON COLUMN bridge_transfers.idempotency_key IS 'Deterministic idempotency key preventing double-bridge submissions';

-- ───────────────────────────────────────────────────────────────────────
-- 3. on_chain_transactions: bridge transfer reference
-- ───────────────────────────────────────────────────────────────────────

ALTER TABLE on_chain_transactions
  ADD COLUMN IF NOT EXISTS bridge_transfer_id UUID REFERENCES bridge_transfers(id);

ALTER TABLE on_chain_transactions
  ADD COLUMN IF NOT EXISTS tx_role TEXT;

COMMENT ON COLUMN on_chain_transactions.bridge_transfer_id IS 'Reference to bridge transfer (for bridge source/destination TXs)';
COMMENT ON COLUMN on_chain_transactions.tx_role IS 'TX role for bridge operations: source | destination | claim';

