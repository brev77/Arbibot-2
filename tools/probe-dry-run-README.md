# Discovery-driven multi-chain dry-run arbitrage probe

`tools/probe-dry-run.mjs` — standalone read-only observation tool that
**autonomously discovers** pools on Arbitrum / Base / Optimism via factory
events, **filters them by on-chain liquidity** (TVL + 24h Swap-event volume),
and records REALIZED cross-DEX round-trip quotes + cross-chain price gaps
into isolated `dry_run_*` tables.

**Why discovery-driven:** the user correctly pointed out that pre-picking
high-liquidity tokens (WETH/USDC/ARB) targets the segment where edge is
already arb-compressed by well-capitalized bots. The real edge — if any —
lives in low/medium liquidity pools ($10K–$500K TVL) below their radar. This
tool discovers those pools programmatically rather than relying on a curated
list.

**Independent of live services.** Never broadcasts transactions, never writes
to `arbitrage_opportunities` / `execution_plans` / `capital_*`.

# Architecture

```
At startup:
  bootstrap() — if dry_run_pool_registry empty, backfill last N blocks
                of PoolCreated/PairCreated events + Algebra probing.

Every cycle:
  Stage 0 (every Nth cycle, default 10):
    a. Incremental sync: new PoolCreated events since last block
    b. Algebra probing: Camelot/Aerodrome/Velodrome pool lookup for
       token pairs discovered in (a)
    c. Liquidity refresh: read TVL + (sampled) 24h volume for registry pools,
       mark eligible = (tvl in [$10K,$500K] AND volume ≥ $1K)

  Stage 1 (every cycle): cross-DEX round-trips
    For every (tokenA, tokenB) with ≥2 DEXes having eligible pools,
    for every ordered (buy_venue, sell_venue):
      quote(buy_venue, A→B, amountIn) → amountOutBuy
      quote(sell_venue, B→A, amountOutBuy) → amountFinal
      round_trip_bps = (amountFinal - amountIn) / amountIn * 10000
      → INSERT dry_run_dex_observations

  Stage 2 (every cycle): cross-chain price gaps
    For every symbol liquid on ≥2 chains (matched by ERC20.symbol):
      price_diff_bps = (sell_price - buy_price) / buy_price * 10000
      [optional] bridge_fee_bps via Across API
      → INSERT dry_run_cross_chain_observations
```

## Files

| File | Purpose |
|---|---|
| `tools/probe-dry-run.mjs` | Main loop, quote primitives, persistence, cross-chain |
| `tools/probe-discovery.mjs` | Factory event sync, Algebra probing, TVL/volume reads |
| `tools/probe-config.json` | Filter params, seed tokens, discovery settings |
| `tools/probe-analysis.sql` | Analysis queries |
| `infra/postgres/migrations/055_dry_run_observations.sql` | Phase 1+2 observation tables |
| `infra/postgres/migrations/056_dry_run_discovery.sql` | Pool registry + liquidity snapshots |

## Setup

```bash
# 1. Apply migrations 055 + 056
DATABASE_URL=postgres://... npm run db:migrate

# 2. Configure RPC + DB in .env
PROBE_RPC_ARBITRUM_URL=https://your-quicknode.arbitrum.quiknode.pro/.../
PROBE_RPC_BASE_URL=...
PROBE_RPC_OPTIMISM_URL=...
PROBE_DATABASE_URL=postgres://...   # defaults to DATABASE_URL
# Optional: ACROSS_API_KEY=... ACROSS_INTEGRATOR_ID=...

# 3. Tune filter (tools/probe-config.json)
#    filter.tvlMinUsd = 10000       # lower bound per pool
#    filter.tvlMaxUsd = 500000      # upper bound (above this = high-liq, arb-compressed)
#    filter.volume24hMinUsd = 1000  # dust filter
#    discovery.backfillBlocks = 100000  # ~2mo Arbitrum, ~6mo Base/Op
```

**QuickNode Build plan ($49/mo)** works. Free public RPC will 429 during
backfill (which makes O(10K-50K) eth_getLogs calls per chain).

## Run

```bash
# Single-cycle smoke (backfill happens first if registry empty — can take 5-15 min):
npm run probe:dry-run:once

# Force one-time deeper backfill:
node tools/probe-dry-run.mjs --backfill

# Continuous loop:
npm run probe:dry-run

# Stop: SIGINT (Ctrl-C) or SIGTERM
```

## How discovery works

### V3 + V2 factory events (Uniswap V3, SushiSwap V2)
Listens to `PoolCreated` (V3) / `PairCreated` (V2) events via `eth_getLogs`,
pages through block ranges (5000 blocks/page, auto-shrinks on RPC range
errors). Each discovered pool is upserted into `dry_run_pool_registry` with
its `token0`, `token1`, `fee` (V3 only), `dex`, `pool_type`, and
`created_at_block`.

### Algebra probing (Camelot, Aerodrome, Velodrome Slipstream)
These DEXes use Algebra Integral (dynamic fees, non-standard factory events).
Instead of event sync, we **probe** the factory's `pool(tokenA, tokenB)`
view for every unique token pair discovered via V3/V2 events. This adds
their pools to the registry.

### Liquidity refresh (Stage 0c)
For each pool in registry (newest 500 per refresh):
- **TVL (V2):** `getReserves()` → `reserve0 × price0 + reserve1 × price1`
- **TVL (V3):** virtual reserves from `liquidity + slot0.sqrtPriceX96`
  (marginal-liquidity approximation — true in-range TVL needs tick bitmap
  walk; good enough for a band filter)
- **24h volume:** `eth_getLogs` for Swap events over last 24h of blocks,
  summed in USD. Expensive — sampled at 10% of pools per cycle to respect
  RPC budget. (Tune via `nScanned % 10` in `probe-dry-run.mjs`.)

Pools are marked `eligible = TRUE` in `dry_run_liquidity_snapshots` if
`$10K ≤ TVL ≤ $500K` AND (volume ≥ $1K OR volume not sampled this cycle).

## Analyze

```bash
psql "$PROBE_DATABASE_URL" -f tools/probe-analysis.sql
psql "$PROBE_DATABASE_URL" -f tools/probe-analysis.sql -v hours=48
```

Additional discovery-specific queries:

```sql
-- Universe coverage: how many pools are we observing?
SELECT chain_id, dex, pool_type, COUNT(*) AS n_pools
FROM dry_run_pool_registry GROUP BY 1,2,3 ORDER BY 1,2;

-- Eligible pool distribution (TVL histogram)
SELECT chain_id,
  width_bucket(tvl_usd, 10000, 500000, 10) AS bucket,
  COUNT(*) AS n_pools,
  AVG(tvl_usd)::numeric(12,0) AS avg_tvl
FROM dry_run_liquidity_snapshots
WHERE eligible = TRUE AND observed_at > NOW() - INTERVAL '1 hour'
GROUP BY 1,2 ORDER BY 1,2;

-- Top eligible pools by 24h volume (most likely to have real edge)
SELECT p.dex, p.token0_symbol, p.token1_symbol,
  s.tvl_usd::numeric(12,0) AS tvl, s.volume_24h_usd::numeric(12,0) AS vol_24h
FROM dry_run_liquidity_snapshots s
JOIN dry_run_pool_registry p ON p.chain_id = s.chain_id AND p.pool_addr = s.pool_addr
WHERE s.eligible = TRUE AND s.observed_at > NOW() - INTERVAL '1 hour'
ORDER BY s.volume_24h_usd DESC NULLS LAST LIMIT 25;
```

## Honest caveats

1. **Backfill is slow.** First run with empty registry will take 5-15 min
   per chain (50K-150K `eth_getLogs` calls at 12 rps). Be patient or use
   `--backfill` flag with a coffee break.
2. **24h volume is sampled (10%).** Reading Swap events for every pool
   every cycle would burn the RPC budget. Full-scan volume is available
   on request — bump `nScanned % 10` to `% 1` in `refreshLiquidityForChain`.
3. **V3 TVL is approximate (virtual reserves).** Pools far out of their
   tick range will have overstated virtual TVL. For the band filter
   ($10K-$500K) this is acceptable; for precise TVL use Dune.
4. **Algebra factory addresses** for Camelot (`0xAA3E…`) and Aerodrome
   (`0x330E…`) are best-effort — verify on first run. Velodrome factory
   (`0xF104…`) is from contracts-eth.
5. **Edge ≠ profit.** Same caveat as before: positive `round_trip_bps` is
   the optimistic bound (no race conditions / mempool / gas spikes / MEV).
6. **Discovery finds what exists, not what's profitable.** Universe
   expansion increases coverage but doesn't guarantee signal.

## Cleanup

```sql
TRUNCATE dry_run_dex_observations, dry_run_cross_chain_observations,
         dry_run_liquidity_snapshots, dry_run_pool_registry;
-- or DROP all four tables; migrations 055+056 have IF NOT EXISTS guards.
```
