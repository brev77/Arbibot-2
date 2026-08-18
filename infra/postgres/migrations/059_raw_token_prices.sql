-- Migration 060: PLAN14 #57 — raw tier: reserves-based token prices + spreads,
-- hourly aggregates (retention tiering).
--
-- The raw tier reads ALL alive pools' reserves/slot0 via Multicall3 (no quoter
-- calls) every raw.intervalCycles, derives marginal USD prices from reserves
-- against quote tokens (USDC/USDT/DAI/USDCe = $1, WETH = raw WETH/stable ratio),
-- and computes fee-adjusted cross-chain spreads per token. Tokens whose spread
-- exceeds raw.triggerBps become the trigger-driven Phase-2 quote list.
--
-- Retention tiering (review №7): full resolution kept raw.retentionHours (48h),
-- older rows collapse into dry_run_raw_token_hourly (median price / p95 spread)
-- and are deleted — without tiering the table grows 15–30M rows/month.
--
-- Idempotent.

CREATE TABLE IF NOT EXISTS dry_run_raw_token_prices (
  id                BIGSERIAL PRIMARY KEY,
  observed_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  run_id            TEXT NOT NULL,
  chain_id          INT NOT NULL,
  token_addr        TEXT NOT NULL,
  symbol            TEXT,
  price_marginal_usd NUMERIC(20,8) NOT NULL,   -- reserves-based, fee-free marginal
  best_venue        TEXT NOT NULL,             -- dex of the deepest direct-quote pool
  pool_addr         TEXT NOT NULL,
  depth_usd         NUMERIC(20,4),             -- quote-side reserve value (raw TVL proxy)
  spread_cross_bps  NUMERIC(10,4),             -- fee-adjusted vs best other chain (this = buy side)
  trust             TEXT,                      -- canonical | heuristic
  newborn           BOOLEAN NOT NULL DEFAULT FALSE,
  metadata          JSONB DEFAULT '{}'        -- fee_bps, quote_token, group, gates
);
CREATE INDEX IF NOT EXISTS idx_raw_tok_time ON dry_run_raw_token_prices (token_addr, observed_at DESC);
CREATE INDEX IF NOT EXISTS idx_raw_tok_observed ON dry_run_raw_token_prices (observed_at);
CREATE INDEX IF NOT EXISTS idx_raw_tok_spread ON dry_run_raw_token_prices (observed_at DESC) WHERE spread_cross_bps IS NOT NULL;

CREATE TABLE IF NOT EXISTS dry_run_raw_token_hourly (
  chain_id          INT NOT NULL,
  token_addr        TEXT NOT NULL,
  hour              TIMESTAMPTZ NOT NULL,
  median_price_usd  NUMERIC(20,8),
  p95_spread_bps    NUMERIC(10,4),
  samples           INT NOT NULL,
  best_venue        TEXT,
  PRIMARY KEY (chain_id, token_addr, hour)
);
