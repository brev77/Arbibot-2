-- Migration 039: DEX daily volume aggregate (D4-B-2-LIMITS, L2)
--
-- Persists per-chain daily traded notional (USD) so DexRiskPolicyService can
-- enforce dex.limits.maxDailyNotionalUsd across process restarts (replaces the
-- in-memory Map that reset on every restart).
--
-- `for_date` is the UTC canonical trade date (YYYY-MM-DD). Updated atomically
-- via ON CONFLICT DO UPDATE (race-safe, no FOR UPDATE needed).
--
-- Single-writer: execution-orchestrator (DexRiskPolicyService.recordTradeVolume).
-- Readers: DexRiskPolicyService.getDailyVolume, operator dashboards.

CREATE TABLE IF NOT EXISTS dex_daily_volume (
    id              SERIAL PRIMARY KEY,
    chain_id        INTEGER NOT NULL,
    for_date        DATE    NOT NULL,
    volume_usd      DECIMAL(24, 8) NOT NULL DEFAULT 0,
    trade_count     INTEGER NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_dex_daily_volume_chain_id_positive CHECK (chain_id > 0),
    CONSTRAINT chk_dex_daily_volume_volume_nonneg CHECK (volume_usd >= 0),
    CONSTRAINT chk_dex_daily_volume_count_nonneg CHECK (trade_count >= 0)
);

-- Composite uniqueness: one row per (chain, UTC date). Drives the UPSERT.
CREATE UNIQUE INDEX IF NOT EXISTS idx_dex_daily_volume_chain_date
    ON dex_daily_volume (chain_id, for_date);

-- updated_at maintenance (shared function defined in migration 033).
CREATE TRIGGER trigger_dex_daily_volume_updated_at
    BEFORE UPDATE ON dex_daily_volume
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

COMMENT ON TABLE dex_daily_volume IS
    'DEX per-chain daily volume aggregate (D4-B-2-LIMITS, single-writer: execution-orchestrator). Enforces maxDailyNotionalUsd across restarts.';
COMMENT ON COLUMN dex_daily_volume.chain_id IS 'EVM chain id (e.g. 42161 = Arbitrum).';
COMMENT ON COLUMN dex_daily_volume.for_date IS 'UTC canonical trade date (YYYY-MM-DD).';
COMMENT ON COLUMN dex_daily_volume.volume_usd IS 'Cumulative traded notional in USD for (chain_id, for_date).';
COMMENT ON COLUMN dex_daily_volume.trade_count IS 'Number of recorded live trades for (chain_id, for_date).';
