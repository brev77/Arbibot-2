-- Migration 043: bridge_transfers finality tracking (D4-B-5-BRIDGE, L5)
--
-- Adds confirmation-tracking columns to bridge_transfers so the polling worker
-- can persist chain-specific finality progress (source + destination) instead of
-- relying solely on the optimistic timeout_at deadline. This closes the L5 gap:
-- `completed` now requires on-chain proof of delivery, not just elapsed time.
--
-- Single-writer: execution-orchestrator (BridgeTransferService).
-- Readers: BridgeTransferPollingWorker, CrossChainReconciliationService, operator UI.
--
-- Forward-only: all columns are ADD COLUMN IF NOT EXISTS with DEFAULT 0/NULL,
-- which makes the ALTER non-blocking and rollback-safe (per migration 040 convention).

ALTER TABLE bridge_transfers
    ADD COLUMN IF NOT EXISTS source_confirmations INTEGER NOT NULL DEFAULT 0;

ALTER TABLE bridge_transfers
    ADD COLUMN IF NOT EXISTS required_confirmations INTEGER NOT NULL DEFAULT 0;

ALTER TABLE bridge_transfers
    ADD COLUMN IF NOT EXISTS destination_confirmations INTEGER NOT NULL DEFAULT 0;

ALTER TABLE bridge_transfers
    ADD COLUMN IF NOT EXISTS finalized_at TIMESTAMPTZ NULL;

COMMENT ON COLUMN bridge_transfers.source_confirmations IS
    'Confirmations observed on the source chain TX (single-writer: execution-orchestrator). Updated by pollAndUpdateStatus.';
COMMENT ON COLUMN bridge_transfers.required_confirmations IS
    'Chain-specific required confirmations (ETH=12, Arb/Base=1, BNB=15) snapshotted at submit (single-writer: execution-orchestrator).';
COMMENT ON COLUMN bridge_transfers.destination_confirmations IS
    'Confirmations observed on the destination chain fill/delivery TX (single-writer: execution-orchestrator). 0 until destination delivery verified.';
COMMENT ON COLUMN bridge_transfers.finalized_at IS
    'Timestamp when destination delivery was proven on-chain and the transfer reached terminal completed state (single-writer: execution-orchestrator).';
