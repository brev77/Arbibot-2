# Discovery-driven multi-chain dry-run arbitrage probe (PLAN14)

`tools/probe-dry-run.mjs` — standalone read-only observation tool. **Never
broadcasts transactions, never writes to live tables** (`arbitrage_opportunities`,
`execution_plans`, `capital_*` — untouched). Pipeline per PLAN14 (#52/#53/#56/#57):

```
Every cycle (timer 60s; effective ~150s normal / ~20min discovery):
  Gas sample (#52): eth_gasPrice + getL1Fee + block per chain → dry_run_run_stats
  Stage 0 (every 5th): factory event sync + algebra probing + solidly/slipstream/
      sushi pair probing (#57) + MC3-batched liquidity refresh of the FULL registry
  Stage 0.5 (#57, cycle 1 + every 3rd): RAW TIER — MC3 reads of ALL alive pools →
      marginal USD prices from reserves (no quoter calls) → fee-adjusted
      cross-chain spreads → dry_run_raw_token_prices + trigger-driven quote list
  Stage 1: cross-DEX round-trips (phase1 notionals 10/100/1000/10000)
  Stage 2: cross-chain exec (#52): net_pp_bps = pre-positioned dual-leg
      (USDC→token buy chain + token→USDC sell chain, NO bridge) − gas of both
      legs (median-3 smoothed); phase2 notionals 50/100/1000; when the raw tier
      is armed, ONLY triggered + canonical + open-window tokens are quoted
  Stage 3 (#53): opportunity windows — dry_run_arb_opportunities
      (open→expired, 30-min gap, threshold opportunity.minNetPpbps)
```

**Multicall3** (`aggregate`, NEVER `aggregate3` — reverts on BlockPi) batches
view reads; failed batches bisect down to singles. RPC guard: cycle calls over
P95(24h)×1.5 → liquidity refresh stops, `cold_tier_skipped=TRUE`.

## Config (`tools/probe-config.json`)

| Block | Meaning |
|---|---|
| `filter` | legacy eligible band (Phase 1; Phase 2 is trigger-driven since #57) |
| `phase1.notionalsUsd` / `phase2.notionalsUsd` | grids: [10,100,1000,10000] / [50,100,1000] (50/100 open windows, 1000 = depth-only) |
| `opportunity` | `{minNetPpbps: 0, windowMinutes: 30}` — window detector threshold after gas |
| `raw` | `{enabled, intervalCycles: 3, triggerBps: 10 (STARTER — calibrate after 48h of raw data), newbornHours: 72, retentionHours: 48}` |
| `canonicalTokens` | verified cross-chain identity (trust='canonical'); symbol heuristic with gates otherwise |

## Tables (migrations 055–059)

`dry_run_pool_registry`, `dry_run_liquidity_snapshots`, `dry_run_dex_observations`,
`dry_run_cross_chain_observations` (+`net_pp_bps`), `dry_run_run_stats`,
`dry_run_arb_opportunities`, `dry_run_raw_token_prices` + hourly aggregates
(retention: 48h full resolution → hourly median/p95 → delete).

## Tools

| Tool | Purpose |
|---|---|
| `tools/arb-digest.mjs [--hours 24]` | windows digest: lifecycle, notional ladder, skew-suspect, unverified-sell-side, sanity lines |
| `tools/probe-coverage-audit.mjs` | DefiLlama vs registry per venue (exit 2 below 95%) |
| `tools/probe-pp-core.test.mjs` | pure-logic tests (`node --test tools/`) |
| `tools/seed-registry-defillama.mjs` | re-seed from the llama dump (SEED_TVL_MIN=0 for the full universe) |
| `tools/probe-analysis.sql` | legacy Phase-1/2 SQL analytics |

Sushi (verified 2026-08-18): Arb factory live (pools arrive via pair probing);
Base/OP absent — root cause documented in the seeder.

## Run

```bash
PROBE_RPC_{ARBITRUM,BASE,OPTIMISM}_URL=... PROBE_DATABASE_URL=... \
  npm run probe:dry-run            # continuous; :once for a single cycle
node --test tools/                 # unit tests
```
