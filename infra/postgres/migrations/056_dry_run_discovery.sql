-- Migration 056: pool registry + liquidity snapshots for autonomous discovery.
--
-- Purpose: replace the hardcoded token/pair universe in probe-config.json with
-- on-chain discovery. The probe (tools/probe-discovery.mjs) listens to
-- PoolCreated / PairCreated events from Uniswap V3 + SushiSwap V2 factories
-- (V3 fork event signatures vary for Camelot/Aerodrome/Velodrome Slipstream;
-- those are probed via factory.getPool with a seed token list). Each pool is
-- persisted here, then TVL + 24h Swap-event volume are read on a refresh
-- schedule and stored as a time series so the analysis SQL can correlate
-- observed round-trip edges with on-chain liquidity.
--
-- Two tables:
--   dry_run_pool_registry        — append-mostly catalog of discovered pools
--   dry_run_liquidity_snapshots  — time series of TVL + 24h volume per pool
--
-- Idempotent: uses CREATE TABLE IF NOT EXISTS / CREATE INDEX IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS dry_run_pool_registry (
  id                BIGSERIAL PRIMARY KEY,
  chain_id          INT NOT NULL,
  pool_addr         TEXT NOT NULL,
  dex               TEXT NOT NULL,           -- 'uniswap-v3' | 'sushiswap-v2' | 'camelot' | 'aerodrome' | 'velodrome'
  pool_type         TEXT NOT NULL,           -- 'v2' | 'v3' | 'algebra'
  token0_addr       TEXT NOT NULL,
  token1_addr       TEXT NOT NULL,
  fee_millionths    INT,                     -- V3 fee in millionths (500 = 0.05%); NULL for V2 / Algebra dynamic
  token0_symbol     TEXT,                    -- populated lazily; nullable for unknown long-tail tokens
  token1_symbol     TEXT,
  created_at_block  BIGINT,
  discovered_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (chain_id, pool_addr)
);

CREATE INDEX IF NOT EXISTS idx_pool_registry_tokens
  ON dry_run_pool_registry (chain_id, token0_addr, token1_addr);
CREATE INDEX IF NOT EXISTS idx_pool_registry_dex
  ON dry_run_pool_registry (chain_id, dex);

CREATE TABLE IF NOT EXISTS dry_run_liquidity_snapshots (
  id                BIGSERIAL PRIMARY KEY,
  observed_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  run_id            TEXT NOT NULL,
  chain_id          INT NOT NULL,
  pool_addr         TEXT NOT NULL,
  dex               TEXT NOT NULL,
  token0_addr       TEXT NOT NULL,
  token1_addr       TEXT NOT NULL,
  tvl_usd           NUMERIC(20, 4),
  volume_24h_usd    NUMERIC(20, 4),
  reserve0          NUMERIC(50, 0),
  reserve1          NUMERIC(50, 0),
  last_swap_at      TIMESTAMPTZ,
  eligible          BOOLEAN DEFAULT FALSE    -- TRUE if tvl_usd within configured filter range at snapshot time
);

CREATE INDEX IF NOT EXISTS idx_liq_snap_observed
  ON dry_run_liquidity_snapshots (observed_at);
CREATE INDEX IF NOT EXISTS idx_liq_snap_pool_time
  ON dry_run_liquidity_snapshots (chain_id, pool_addr, observed_at DESC);
CREATE INDEX IF NOT EXISTS idx_liq_snap_eligible
  ON dry_run_liquidity_snapshots (observed_at DESC) WHERE eligible = TRUE;
