-- Migration 046: paper_trades settlement columns (PAD-2, L3)
--
-- Adds P/L result columns to paper_trades so a settled paper trade carries its
-- outcome as typed, queryable fields (entry/exit prices, realized P/L, settle ts).
-- Used by AutoDriveWorker (settle phase) and by the /paper/trades/history and
-- /paper/trades/stats read APIs. `notional` is already a typed numeric column on
-- this table; P/L follows the same convention rather than hiding inside `summary`
-- jsonb (which is NOT NULL DEFAULT '{}' but unused for structured financial data).
--
-- Single-writer: paper-trading-service (PaperTradesService.settle). Readers:
-- operator UI via paper-trading-service read APIs; nothing else writes these.
--
-- Forward-only: ADD COLUMN IF NOT EXISTS (nullable, no default) makes the ALTER
-- non-blocking and rollback-safe; existing rows backfill to NULL (draft/active
-- trades have no settlement yet — correct).

ALTER TABLE paper_trades
    ADD COLUMN IF NOT EXISTS entry_price NUMERIC(38, 18);
ALTER TABLE paper_trades
    ADD COLUMN IF NOT EXISTS exit_price  NUMERIC(38, 18);
ALTER TABLE paper_trades
    ADD COLUMN IF NOT EXISTS profit_usd  NUMERIC(24, 8);
ALTER TABLE paper_trades
    ADD COLUMN IF NOT EXISTS settled_at  TIMESTAMPTZ;

COMMENT ON COLUMN paper_trades.entry_price IS
    'Entry (buy) price captured at paper trade settle (PAD-2, single-writer: paper-trading-service). NULL until state = settled.';
COMMENT ON COLUMN paper_trades.exit_price IS
    'Exit (sell) price captured at paper trade settle (PAD-2, single-writer: paper-trading-service). NULL until state = settled.';
COMMENT ON COLUMN paper_trades.profit_usd IS
    'Realized paper P/L in USD recorded at settle (PAD-2, single-writer: paper-trading-service). Pre-slippage: sourced from the opportunity netProfitUsd unless the settle caller overrides. NULL until state = settled.';
COMMENT ON COLUMN paper_trades.settled_at IS
    'Wall-clock settle timestamp (PAD-2, single-writer: paper-trading-service). NULL until state = settled.';

-- Partial indexes scoped to settled rows: history/stats queries filter state = 'settled'
-- and order by settled_at DESC, so these keep the working set small as paper_trades grows.
CREATE INDEX IF NOT EXISTS idx_paper_trades_settled_at
    ON paper_trades (settled_at DESC)
    WHERE state = 'settled';
CREATE INDEX IF NOT EXISTS idx_paper_trades_profit_usd
    ON paper_trades (profit_usd)
    WHERE state = 'settled';
