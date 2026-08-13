-- Migration 055: dry-run observation tables for the standalone multi-chain
-- arbitrage probe (tools/probe-arb-opportunities.mjs, extended).
--
-- Purpose: empirical falsification of the "single-chain and bridge arbitrage
-- are dead at retail capital" conclusion. The probe runs continuously over
-- real Arbitrum / Base / Optimism RPC, records REALIZED round-trip quotes
-- (QuoterV2 / getAmountsOut / Algebra quoter — not mid-price) for every
-- configured pair × notional × venue-pair, and computes cross-chain price
-- gaps net of bridge fees (Across API). NO connection to the live execution
-- path — these tables are write-only by the probe tool and read-only for
-- offline SQL analysis. After the observation window they can be TRUNCATED
-- or DROPped without affecting any service.
--
-- Two tables:
--   dry_run_dex_observations       — Phase 1: cross-DEX round-trips per chain
--   dry_run_cross_chain_observations — Phase 2: cross-chain price gaps net of bridge fees
--
-- Idempotent: uses CREATE TABLE IF NOT EXISTS / CREATE INDEX IF NOT EXISTS.

-- ============================================================================
-- Phase 1: cross-DEX round-trip observations
-- ============================================================================
CREATE TABLE IF NOT EXISTS dry_run_dex_observations (
  id              BIGSERIAL PRIMARY KEY,
  observed_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  run_id          TEXT NOT NULL,                  -- UUID per probe cycle
  chain_id        INT NOT NULL,
  buy_venue       TEXT NOT NULL,                  -- e.g. 'uniswap-v3:0.05%'
  sell_venue      TEXT NOT NULL,                  -- e.g. 'sushiswap-v2'
  token_in        TEXT NOT NULL,                  -- symbol from probe config
  token_out       TEXT NOT NULL,                  -- symbol from probe config
  token_in_addr   TEXT NOT NULL,                  -- checksummed address
  token_out_addr  TEXT NOT NULL,
  notional_usd    NUMERIC(20, 8) NOT NULL,
  amount_in       NUMERIC(50, 0) NOT NULL,        -- raw wei units
  amount_out_buy  NUMERIC(50, 0) NOT NULL,        -- raw units received on buy venue
  amount_final    NUMERIC(50, 0) NOT NULL,        -- raw units after round-trip
  round_trip_bps  NUMERIC(10, 4) NOT NULL,        -- (amount_final - amount_in) / amount_in * 10000
  gas_cost_usd    NUMERIC(10, 6),                 -- estimated 2-leg gas cost in USD (nullable)
  rpc_node        TEXT,                           -- redacted RPC URL for traceability
  metadata        JSONB DEFAULT '{}'              -- pool addresses, fees, slot0, etc.
);

CREATE INDEX IF NOT EXISTS idx_dry_obs_chain_bps
  ON dry_run_dex_observations (chain_id, round_trip_bps DESC);
CREATE INDEX IF NOT EXISTS idx_dry_obs_observed
  ON dry_run_dex_observations (observed_at);
CREATE INDEX IF NOT EXISTS idx_dry_obs_pair
  ON dry_run_dex_observations (chain_id, token_in, token_out);
CREATE INDEX IF NOT EXISTS idx_dry_obs_run
  ON dry_run_dex_observations (run_id);

-- ============================================================================
-- Phase 2: cross-chain price-gap observations (net of bridge fees)
-- ============================================================================
-- A row is written for every (token, buy_chain, sell_chain, bridge_protocol,
-- notional_usd) combination where the token is liquid on both chains.
-- net_edge_bps > 0 means a hypothetical cross-chain arb would profit gross
-- of gas and slippage on the destination DEX (still optimistic — does not
-- account for executor competition or mempool latency).
CREATE TABLE IF NOT EXISTS dry_run_cross_chain_observations (
  id                       BIGSERIAL PRIMARY KEY,
  observed_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  run_id                   TEXT NOT NULL,
  token                    TEXT NOT NULL,                  -- symbol
  token_addr_buy_chain     TEXT NOT NULL,                  -- may differ across chains (e.g. USDC native vs bridged)
  token_addr_sell_chain    TEXT NOT NULL,
  buy_chain_id             INT NOT NULL,
  sell_chain_id            INT NOT NULL,
  notional_usd             NUMERIC(20, 8) NOT NULL,
  price_buy_usd            NUMERIC(20, 8) NOT NULL,        -- USD price of token on buy chain
  price_sell_usd           NUMERIC(20, 8) NOT NULL,        -- USD price of token on sell chain
  price_diff_bps           NUMERIC(10, 4) NOT NULL,        -- (sell - buy) / buy * 10000
  bridge_protocol          TEXT NOT NULL,                  -- 'across' | 'stargate'
  bridge_fee_usd           NUMERIC(20, 8) NOT NULL,
  bridge_fee_bps           NUMERIC(10, 4) NOT NULL,        -- bridge_fee_usd / notional_usd * 10000
  bridge_finality_seconds  INT,                            -- expected fill time from bridge API/docs
  net_edge_bps             NUMERIC(10, 4) NOT NULL,        -- price_diff_bps - bridge_fee_bps
  metadata                 JSONB DEFAULT '{}'              -- bridge quote response, raw fee breakdown
);

CREATE INDEX IF NOT EXISTS idx_dry_cc_edge
  ON dry_run_cross_chain_observations (net_edge_bps DESC);
CREATE INDEX IF NOT EXISTS idx_dry_cc_token
  ON dry_run_cross_chain_observations (token, buy_chain_id, sell_chain_id);
CREATE INDEX IF NOT EXISTS idx_dry_cc_observed
  ON dry_run_cross_chain_observations (observed_at);
CREATE INDEX IF NOT EXISTS idx_dry_cc_run
  ON dry_run_cross_chain_observations (run_id);
