-- Migration 058: PLAN14 #52 + #53 — pre-positioned exec_pp metric, run stats,
-- opportunity windows (dry-run probe workstream).
--
-- Part 1 (#52 FUNC-PROBE-EXEC-PP):
--   * dry_run_cross_chain_observations.net_pp_bps — pre-positioned dual-leg net
--     (USDC -> token on buy chain, token -> USDC on sell chain, NO bridge),
--     gas of both legs included, clamped to ±99999 (garbage guard, lesson of 057).
--   * dry_run_run_stats — per cycle × chain telemetry: gas sample (price, L1 fee,
--     median-3 smoothed), cycle block, WETH price, RPC call counter, cycle duration.
--     source = 'cycle' | 'event' (#58 event-triggered passes write synthetic
--     run_id 'event-<uuid>' — NOT NULL on run_id is preserved everywhere).
--
-- Part 2 (#53 FUNC-PROBE-OPPORTUNITY-WINDOWS):
--   * dry_run_arb_opportunities — one row per opportunity window with a lifecycle
--     (open → expired). Dedup gate = partial UNIQUE over OPEN windows only
--     (pattern of migration 050); the plain UNIQUE(..., first_seen) variant from
--     ТЗ v4 was dropped — it deduplicated nothing (rows differ by construction).
--
-- Idempotent: ADD COLUMN IF NOT EXISTS / CREATE TABLE IF NOT EXISTS.

ALTER TABLE dry_run_cross_chain_observations
  ADD COLUMN IF NOT EXISTS net_pp_bps NUMERIC(10,4);

CREATE TABLE IF NOT EXISTS dry_run_run_stats (
  id                BIGSERIAL PRIMARY KEY,
  run_id            TEXT NOT NULL,               -- 'event-<uuid>' for #58 event passes
  chain_id          INT NOT NULL,
  block_number      BIGINT NOT NULL,             -- cycle block → block_buy/block_sell in cc-obs metadata
  gas_price_gwei    NUMERIC(12,6) NOT NULL,
  l1_fee_eth        NUMERIC(18,12),              -- NULL on Arbitrum (L1 share negligible: 261 gas)
  gas_eth_smoothed  NUMERIC(18,12) NOT NULL,     -- median of current + 2 previous chain samples
  eth_usd           NUMERIC(12,4) NOT NULL,
  rpc_calls         INT NOT NULL,
  cycle_ms          INT NOT NULL,
  cold_tier_skipped BOOLEAN NOT NULL DEFAULT FALSE,
  source            TEXT NOT NULL DEFAULT 'cycle',
  observed_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (run_id, chain_id)
);
CREATE INDEX IF NOT EXISTS idx_run_stats_time ON dry_run_run_stats (observed_at DESC);

CREATE TABLE IF NOT EXISTS dry_run_arb_opportunities (
  id                BIGSERIAL PRIMARY KEY,
  token             TEXT NOT NULL,
  token_addr_buy    TEXT NOT NULL,
  token_addr_sell   TEXT NOT NULL,
  buy_chain_id      INT NOT NULL,
  sell_chain_id     INT NOT NULL,
  trust             TEXT NOT NULL,
  first_seen        TIMESTAMPTZ NOT NULL,
  last_seen         TIMESTAMPTZ NOT NULL,
  samples           INT NOT NULL DEFAULT 1,       -- observations, NOT cycles (hot/cold breaks cycle semantics)
  run_ids           TEXT[] NOT NULL DEFAULT '{}', -- DISTINCT run_id (append-dedup)
  net_bps_at_50     NUMERIC(10,2),
  net_bps_at_100    NUMERIC(10,2),
  net_bps_at_1000   NUMERIC(10,2),                -- informational depth; never opens/extends a window
  gas_bps_last      NUMERIC(10,2),
  best_net_bps      NUMERIC(10,2) NOT NULL,
  best_notional_usd NUMERIC(20,2) NOT NULL,
  max_notional_positive NUMERIC(20,2) NOT NULL,   -- monotone; window qualification ≥ 50
  venue_pair        TEXT,
  bridge_fee_bps_last NUMERIC(10,4),              -- reference only, NOT a gate
  tvl_buy_usd_last  NUMERIC(20,4),
  tvl_sell_usd_last NUMERIC(20,4),
  filter_config_id  BIGINT,                       -- FK target exists after migration 059 (#54); nullable
  status            TEXT NOT NULL DEFAULT 'open',
  expired_at        TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_arb_opp_open
  ON dry_run_arb_opportunities (token_addr_buy, token_addr_sell, buy_chain_id, sell_chain_id)
  WHERE status = 'open';
CREATE INDEX IF NOT EXISTS idx_arb_opp_token
  ON dry_run_arb_opportunities (token, last_seen DESC);
CREATE INDEX IF NOT EXISTS idx_arb_opp_status
  ON dry_run_arb_opportunities (status, best_net_bps DESC);
