#!/usr/bin/env node
/**
 * Multi-chain continuous dry-run arbitrage probe — discovery-driven.
 *
 * Replaces the hardcoded token universe with autonomous on-chain discovery:
 *   1. Factory event sync (Uniswap V3 PoolCreated + Sushi V2 PairCreated) +
 *      Algebra probing (Camelot / Aerodrome / Velodrome Slipstream).
 *   2. Liquidity filter: read TVL (virtual reserves) + 24h Swap-event volume
 *      (sampled 1-in-10 pools, PROBE_VOLUME_SAMPLE) for discovered pools,
 *      persist into dry_run_liquidity_snapshots, mark pools with
 *      $1K ≤ TVL ≤ $5M and 24h volume ≥ $100 as `eligible`.
 *   3. Quote cycle (Phase 1): round-trip quotes for every eligible
 *      cross-DEX pair (tokenA, tokenB where ≥2 DEXes have eligible pools).
 *   4. Cross-chain cycle (Phase 2): price gaps for tokens liquid on ≥2 chains.
 *   5. exec_pp (PLAN14 #52): pre-positioned dual-leg net on phase2 notionals
 *      {50,100,1000} — USDC→token (buy chain) + token→USDC (sell chain), NO
 *      bridge, gas of both legs included (median-3 smoothed sample per cycle,
 *      dry_run_run_stats telemetry).
 *   6. Stage 3 (PLAN14 #53): opportunity windows — dry_run_arb_opportunities,
 *      open→expired lifecycle, 30-min gap, threshold opportunity.minNetPpbps.
 *
 * Targeting LOW liquidity ($1K–$5M TVL, see probe-config.json
 * filter.tvlMinUsd/tvlMaxUsd; floor lowered from $10K on 2026-08-15 after the
 * mid band measured dead cross-DEX) — high-liquidity pools (WETH/USDC etc.)
 * are arbed to zero by well-capitalized bots; the edge, if any, lives in pools
 * below their radar. The filter is the user's explicit ask — the $1K floor
 * admits thin pools where transient dislocations live, at the cost of
 * scam/dust noise (trust gates + volume sampling are the counterweight).
 *
 * This tool NEVER broadcasts transactions and is INDEPENDENT of all live
 * services (no capital / execution-orchestrator / opportunity-service).
 *
 * Usage:
 *   PROBE_RPC_ARBITRUM_URL=... PROBE_RPC_BASE_URL=... PROBE_RPC_OPTIMISM_URL=... \
 *   PROBE_DATABASE_URL=postgres://... \
 *   node tools/probe-dry-run.mjs --continuous
 *
 *   # single-cycle smoke:
 *   node tools/probe-dry-run.mjs
 *
 *   # force one-time historical backfill of N blocks at startup:
 *   node tools/probe-dry-run.mjs --backfill
 *
 * Phase 2 bridge fees come from the PUBLIC Across suggested-fees API (no
 * key required) and every non-suspicious cross-chain row carries metadata.exec
 * — the honest USDC -> token -> bridge -> token -> USDC round-trip quoted at
 * real notional (marginal 1-unit pricing produced phantom gaps).
 */

import { ethers } from 'ethers';
import pg from 'pg';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  FACTORIES, ALGEBRA_DEXES,
  backfillPools, incrementalSync, probeAlgebraPools,
  readPoolTvlV2, readPoolTvlV3, readPoolTvlAlgebra, readPoolTvlSlipstream, readPoolVolume24h,
  insertPool, insertLiquiditySnapshot, setTokenSymbol, getEligibleCrossDexPairs,
} from './probe-discovery.mjs';
import {
  computeGasEth, median3, gasBpsUsd, computeNetPpBps, aggregateObservations,
} from './probe-pp-core.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = path.join(__dirname, 'probe-config.json');

const CONTINUOUS = process.argv.includes('--continuous');
const FORCE_BACKFILL = process.argv.includes('--backfill');
const PERIOD_SEC = Math.max(10, Number(process.env.PROBE_PERIOD_SECONDS ?? 60));
const DB_URL = process.env.PROBE_DATABASE_URL ?? process.env.DATABASE_URL;
const RATE_LIMIT_RPS = Number(process.env.PROBE_RATE_LIMIT_RPS ?? 12);

const ACROSS_API_BASE = 'https://app.across.to/api';

if (!DB_URL) {
  console.error('PROBE_DATABASE_URL (or DATABASE_URL) is required.');
  process.exit(1);
}

const config = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
// Normalize all seed-token addresses (config may carry broken EIP-55 checksums)
for (const chain of Object.values(config.chains)) {
  if (chain.seedTokens) {
    for (const t of Object.values(chain.seedTokens)) {
      t.addr = ethers.getAddress(t.addr.toLowerCase());
    }
  }
}
const CHAIN_IDS = Object.keys(config.chains).map(Number);
const FILTER = config.filter;
const DISCOVERY = config.discovery;
// PLAN14: grids are split — Phase 1 keeps the historical grid (dex-obs
// comparability), Phase 2 moves to the operator-decided {50,100,1000}.
const PHASE1_NOTIONALS = config.phase1?.notionalsUsd ?? config.notionalsUsd ?? [10, 100, 1000, 10000];
const PHASE2_NOTIONALS = config.phase2?.notionalsUsd ?? config.notionalsUsd ?? [50, 100, 1000];
const OPPORTUNITY_CFG = config.opportunity ?? { minNetPpbps: 0, windowMinutes: 30 };
const BLOCK_TIME_SEC = { 42161: 0.25, 8453: 2, 10: 2 };

// ============================================================================
// Per-chain quoter / router addresses (config constants, not from discovery)
// ============================================================================
const VENUE_INFRA = {
  42161: [
    { key: 'uniswap-v3',   type: 'v3',       addr: '0x61fFE014bA17989E743c5F6cB21bF9697530B21e', label: 'UniV3' },
    { key: 'sushiswap-v2', type: 'v2',       addr: '0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506', label: 'Sushi' },
    { key: 'camelot',      type: 'algebra',  addr: '0x0fc73040b26e9bc8514fa028d998e73a254fa76e', label: 'Camelot' },
  ],
  8453: [
    // official Base deployment (developers.uniswap.org); contracts-eth has
    // a different tail (0x3d4Ba44E... = EOA)
    { key: 'uniswap-v3',   type: 'v3',       addr: '0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a', label: 'UniV3' },
    // Aerodrome V2 (Solidly AMM) — router quotes via Route-struct
    // getAmountsOut(uint256,(from,to,stable,factory)[]); legacy address[]
    // form does NOT exist (verified on-chain 2026-08-15). `factory` is
    // required by the route struct.
    { key: 'aerodrome-v2', type: 'solidly',  addr: '0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43',
      factory: '0x420DD381b31aEf6683db6B902084cB0FFECe40Da', label: 'AerodromeV2' },
    // Aerodrome Slipstream (CL), original deployment — same tuple5 quoter ABI
    // as Velodrome Slipstream (verified on-chain 2026-08-15: 1.8808 USDC).
    // NOTE: the Aerodrome CL factory uses getPool(a,b,int24) — see seeder.
    { key: 'aerodrome-slipstream', type: 'slipstream', addr: '0x254cF9E1E6e233aa1AC962CB9B05b2cfeAaE15b0', label: 'AeroSlipstream' },
  ],
  10: [
    // deterministic CREATE2 deployment — same address on Ethereum/Arbitrum/Optimism
    // (0x2779a0CC... from contracts-eth is an EOA — bytecode 0)
    { key: 'uniswap-v3',   type: 'v3',         addr: '0x61fFE014bA17989E743c5F6cB21bF9697530B21e', label: 'UniV3' },
    // Velodrome V2 (Solidly AMM): V2-compatible router with getAmountsOut
    { key: 'velodrome-v2', type: 'v2',         addr: '0xa062AE8AdF9C7717ba7a2364A8F8a25202F1fCb1', label: 'VelodromeV2' },
    // Velodrome Slipstream (CL), gaugesV2 deployment — quoter ABI verified
    // on-chain 2026-08-15: tuple (tokenIn, tokenOut, amountIn, int24
    // tickSpacing, sqrtPriceLimitX96). Pools carry their tickSpacing in
    // registry fee_millionths (seeder quirk).
    { key: 'velodrome-slipstream', type: 'slipstream', addr: '0xAd432b2ca49965266133F2bd4c17dc1Ec12f5DEB', label: 'Slipstream' },
  ],
};

const providers = {};
const rpcLabels = {};
for (const id of CHAIN_IDS) {
  const url = process.env[config.chains[id].rpcEnv];
  if (!url) {
    console.error(`Missing env ${config.chains[id].rpcEnv} (chain ${id}).`);
    process.exit(1);
  }
  providers[id] = new ethers.JsonRpcProvider(url, id, { staticNetwork: true });
  rpcLabels[id] = url.replace(/(v[0-9]\/)[A-Za-z0-9_-]+/, '$1<KEY>');
}

const db = new pg.Pool({ connectionString: DB_URL, max: 4 });
// Idle client errors (Docker postgres resets, network blips) emit 'error' on
// the pool — without a listener Node treats them as uncaught exceptions and
// the process dies (observed as a pm2 restart loop on the Aéza host).
db.on('error', (e) => console.error(`[pg pool] ${e.message}`));

// ============================================================================
// Rate limiter
// ============================================================================
const buckets = Object.fromEntries(CHAIN_IDS.map((id) => [id, { tokens: RATE_LIMIT_RPS, last: Date.now() }]));
const rpcCalls = Object.fromEntries(CHAIN_IDS.map((id) => [id, 0]));
function tryAcquire(chainId) {
  const b = buckets[chainId];
  const now = Date.now();
  b.tokens = Math.min(RATE_LIMIT_RPS, b.tokens + ((now - b.last) / 1000) * RATE_LIMIT_RPS);
  b.last = now;
  if (b.tokens >= 1) { b.tokens -= 1; rpcCalls[chainId] += 1; return true; }
  return false;
}
async function acquire(chainId, maxWaitMs = 600) {
  const deadline = Date.now() + maxWaitMs;
  while (!tryAcquire(chainId)) {
    if (Date.now() > deadline) return false;
    await sleep(100);
  }
  return true;
}
const rateLimitFn = async (chainId) => { await acquire(chainId); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ============================================================================
// Gas sampling + run_stats telemetry (#52): 3 RPC per chain per cycle
// (eth_blockNumber, eth_gasPrice, GasPriceOracle.getL1Fee on Base/OP).
// The metric uses the median-3 smoothed sample — Arb gasPrice spikes
// (0.02 → 0.5 gwei) must not falsely close windows; the instant sample
// stays in dry_run_run_stats for diagnostics.
// ============================================================================
const GAS_PRICE_ORACLE = '0x420000000000000000000000000000000000000F';
const GPO_ABI = ['function getL1Fee(bytes data) view returns (uint256)'];
// ~260B canonical swap calldata (exactInputSingle) — encoding only, never sent
const CANON_SWAP_IFACE = new ethers.Interface([
  'function exactInputSingle((address tokenIn,address tokenOut,uint24 fee,address recipient,bool zeroForOne,int256 amountSpecified,uint160 sqrtPriceLimitX96,uint256 deadline)) payable returns (int256 amount0,int256 amount1)',
]);
const CANONICAL_SWAP_CALLDATA = CANON_SWAP_IFACE.encodeFunctionData('exactInputSingle', [{
  tokenIn: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  tokenOut: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
  fee: 500, recipient: '0x0000000000000000000000000000000000000001', zeroForOne: true,
  amountSpecified: 1000000n, sqrtPriceLimitX96: 0n, deadline: 9999999999n,
}]);
const chainGas = {}; // chainId → { blockNumber, gasPriceWei, l1FeeEth, gasEth, smoothed, history[] }

async function sampleChainGas(chainId) {
  if (!(await acquire(chainId))) return;
  const blockNumber = await providers[chainId].getBlockNumber();
  let gasPrice = null;
  try { gasPrice = BigInt(await providers[chainId].send('eth_gasPrice')); } catch { return; }
  let l1FeeEth = null;
  if (chainId !== 42161) {
    if (await acquire(chainId)) {
      try {
        const c = new ethers.Contract(GAS_PRICE_ORACLE, GPO_ABI, providers[chainId]);
        l1FeeEth = Number(ethers.formatEther(await c.getL1Fee.staticCall(CANONICAL_SWAP_CALLDATA)));
      } catch { /* L1 component optional */ }
    }
  }
  const gasEth = computeGasEth({ gasPriceWei: gasPrice, l1FeeEth });
  if (gasEth == null) return;
  chainGas[chainId] ??= { history: [] };
  chainGas[chainId].history.push(gasEth);
  if (chainGas[chainId].history.length > 3) chainGas[chainId].history = chainGas[chainId].history.slice(-3);
  Object.assign(chainGas[chainId], {
    blockNumber, gasPriceWei: gasPrice, l1FeeEth, gasEth,
    smoothed: median3(chainGas[chainId].history),
  });
}

async function legGasBps(chainId, notionalUsd) {
  const g = chainGas[chainId];
  if (!g || g.smoothed == null) return null;
  const weth = config.chains[chainId].seedTokens.WETH.addr;
  const ethUsd = await getPriceUsd(chainId, weth);
  if (ethUsd == null) return null;
  return gasBpsUsd({ gasEth: g.smoothed, ethUsd, notionalUsd });
}

async function persistRunStats(runId, cycleMs) {
  for (const chainId of CHAIN_IDS) {
    const g = chainGas[chainId];
    if (!g || g.smoothed == null) continue;
    const weth = config.chains[chainId].seedTokens.WETH.addr;
    const ethUsd = await getPriceUsd(chainId, weth).catch(() => null);
    if (ethUsd == null) continue;
    try {
      await db.query(
        `INSERT INTO dry_run_run_stats
           (run_id, chain_id, block_number, gas_price_gwei, l1_fee_eth, gas_eth_smoothed,
            eth_usd, rpc_calls, cycle_ms, cold_tier_skipped, source)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'cycle')
         ON CONFLICT (run_id, chain_id) DO NOTHING`,
        [runId, chainId, g.blockNumber,
         Number(ethers.formatUnits(g.gasPriceWei, 'gwei')), g.l1FeeEth, g.smoothed,
         ethUsd, rpcCalls[chainId], Math.round(cycleMs), coldTierSkipped[chainId] === true],
      );
    } catch (e) { console.error(`[run_stats ${chainId}] ${e.message.slice(0, 80)}`); }
  }
}

// ============================================================================
// ABIs + ERC20 metadata cache (per chain: addr → { decimals, symbol })
// ============================================================================
const ERC20_ABI = ['function decimals() view returns (uint8)', 'function symbol() view returns (string)'];
const V2_ABI = ['function getAmountsOut(uint256 amountIn, address[] path) view returns (uint256[] amounts)'];
const V3_QUOTER_ABI = ['function quoteExactInputSingle((address tokenIn,address tokenOut,uint256 amountIn,uint24 fee,uint160 sqrtPriceLimitX96)) external returns (uint256 amountOut,uint160 sqrtPriceX96After,uint32 initializedTicksCrossed,uint256 gasCost)'];
const ALGEBRA_QUOTER_ABI = ['function quoteExactInputSingle(address tokenIn, address tokenOut, uint256 amountIn, uint160 limitSqrtPrice) external returns (uint256 amountOut)'];
// Velodrome Slipstream quoter — UniV3-QuoterV2-style tuple, but tickSpacing
// instead of fee. Verified on-chain 2026-08-15 (0.001 WETH → 1.879 USDC on
// both live quoters; flat and fee-tuple variants revert). The SAME ABI works
// for Aerodrome Slipstream on Base (1.8808 USDC).
const SLIPSTREAM_QUOTER_ABI = ['function quoteExactInputSingle((address tokenIn, address tokenOut, uint256 amountIn, int24 tickSpacing, uint160 sqrtPriceLimitX96)) external returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)'];
// Solidly AMM routers (Aerodrome) — Route-struct quoting; the legacy
// getAmountsOut(uint256, address[]) form does not exist on Aerodrome
// (verified on-chain 2026-08-15).
const SOLIDLY_ROUTER_ABI = ['function getAmountsOut(uint256 amountIn, (address from, address to, bool stable, address factory)[] routes) view returns (uint256[] amounts)'];

const erc20Cache = {}; // erc20Cache[chainId][addrLower] = { decimals, symbol }
async function getErc20Meta(chainId, addr) {
  const lower = addr.toLowerCase();
  erc20Cache[chainId] ??= {};
  if (erc20Cache[chainId][lower]) return erc20Cache[chainId][lower];
  const c = new ethers.Contract(addr, ERC20_ABI, providers[chainId]);
  try {
    const [decimals, symbol] = await Promise.all([c.decimals.staticCall(), c.symbol.staticCall().catch(() => null)]);
    erc20Cache[chainId][lower] = { decimals: Number(decimals), symbol };
    // Persist symbol into registry if known
    if (symbol) await setTokenSymbol(db, chainId, addr, symbol).catch(() => {});
  } catch {
    erc20Cache[chainId][lower] = { decimals: 18, symbol: null }; // sensible default
  }
  return erc20Cache[chainId][lower];
}

// ============================================================================
// USD price cache (per chain: addr → USD price per 1 token unit)
// ============================================================================
const priceCache = {}; // priceCache[chainId][addrLower] = { priceUsd, ts }
const PRICE_CACHE_TTL_MS = 60_000;
async function getPriceUsd(chainId, addr) {
  const lower = addr.toLowerCase();
  priceCache[chainId] ??= {};
  const cached = priceCache[chainId][lower];
  if (cached && Date.now() - cached.ts < PRICE_CACHE_TTL_MS) return cached.priceUsd;
  // Stablecoins = $1 (cheap shortcut)
  const seedTokens = Object.values(config.chains[chainId].seedTokens);
  const isStable = seedTokens.find((t) => t.addr.toLowerCase() === lower);
  if (isStable && ['USDC', 'USDCe', 'USDT', 'DAI'].includes(isStable.symbol ?? '')) {
    priceCache[chainId][lower] = { priceUsd: 1, ts: Date.now() };
    return 1;
  }
  // Quote 1 unit of token → USDC via the most liquid venue (V3 quoter first)
  const meta = await getErc20Meta(chainId, addr);
  const one = 10n ** BigInt(meta.decimals);
  const usdcAddr = config.chains[chainId].seedTokens.USDC.addr;
  if (addr.toLowerCase() === usdcAddr.toLowerCase()) return 1;
  // Try V3 quoter across fee tiers, then Algebra, then V2
  const wethAddr = config.chains[chainId].seedTokens.WETH.addr;
  for (const fee of [500, 3000]) {
    const out = await quoteV3(chainId, addr, usdcAddr, one, fee);
    if (out && out > 0n) {
      const p = Number(ethers.formatUnits(out, 6));
      priceCache[chainId][lower] = { priceUsd: p, ts: Date.now() };
      return p;
    }
  }
  // Token → WETH → USDC fallback for less-liquid long-tail
  const wethOut = await quoteV3(chainId, addr, wethAddr, one, 500).catch(() => null)
    ?? await quoteAlgebra(chainId, addr, wethAddr, one)
    ?? await quoteSlipstreamAnyTs(chainId, addr, wethAddr, one)
    ?? await quoteSolidly(chainId, addr, wethAddr, one);
  if (wethOut && wethOut > 0n) {
    const usdcOut = await quoteV3(chainId, wethAddr, usdcAddr, wethOut, 500);
    if (usdcOut && usdcOut > 0n) {
      const p = Number(ethers.formatUnits(usdcOut, 6));
      priceCache[chainId][lower] = { priceUsd: p, ts: Date.now() };
      return p;
    }
  }
  return null;
}

// ============================================================================
// Quote primitives (V2 / V3 / Algebra)
// ============================================================================
async function quoteV2(chainId, tokenIn, tokenOut, amountIn) {
  const v = VENUE_INFRA[chainId].find((x) => x.type === 'v2');
  if (!v) return null;
  if (!(await acquire(chainId))) return null;
  try {
    const r = new ethers.Contract(v.addr, V2_ABI, providers[chainId]);
    const out = await r.getAmountsOut.staticCall(amountIn, [tokenIn, tokenOut]);
    return out[1];
  } catch { return null; }
}

async function quoteV3(chainId, tokenIn, tokenOut, amountIn, fee) {
  const v = VENUE_INFRA[chainId].find((x) => x.key === 'uniswap-v3');
  if (!v) return null;
  if (!(await acquire(chainId))) return null;
  try {
    const q = new ethers.Contract(v.addr, V3_QUOTER_ABI, providers[chainId]);
    const res = await q.quoteExactInputSingle.staticCall({
      tokenIn, tokenOut, amountIn, fee, sqrtPriceLimitX96: 0n,
    });
    return res[0];
  } catch { return null; }
}

async function quoteAlgebra(chainId, tokenIn, tokenOut, amountIn) {
  // Find any Algebra venue for this chain (Camelot / Aerodrome / Velodrome)
  const algVenues = VENUE_INFRA[chainId].filter((x) => x.type === 'algebra');
  for (const v of algVenues) {
    if (!(await acquire(chainId))) return null;
    try {
      const q = new ethers.Contract(v.addr, ALGEBRA_QUOTER_ABI, providers[chainId]);
      const out = await q.quoteExactInputSingle.staticCall(tokenIn, tokenOut, amountIn, 0n);
      if (out && out > 0n) return out;
    } catch { /* try next */ }
  }
  return null;
}

async function quoteSlipstream(chainId, tokenIn, tokenOut, amountIn, tickSpacing) {
  const v = VENUE_INFRA[chainId]?.find((x) => x.type === 'slipstream');
  if (!v || tickSpacing == null) return null;
  if (!(await acquire(chainId))) return null;
  try {
    const q = new ethers.Contract(v.addr, SLIPSTREAM_QUOTER_ABI, providers[chainId]);
    const res = await q.quoteExactInputSingle.staticCall({
      tokenIn, tokenOut, amountIn, tickSpacing: Number(tickSpacing), sqrtPriceLimitX96: 0n,
    });
    return res[0];
  } catch { return null; }
}

// Fallback for long-tail tokens whose only OP/Base pool is a Slipstream pool:
// try common tick spacings (a wrong ts simply reverts → null).
async function quoteSlipstreamAnyTs(chainId, tokenIn, tokenOut, amountIn) {
  for (const ts of [100, 50, 200, 10]) {
    const out = await quoteSlipstream(chainId, tokenIn, tokenOut, amountIn, ts);
    if (out && out > 0n) return out;
  }
  return null;
}

// Solidly AMM (Aerodrome V2): Route-struct quoting, volatile variant
// (stable=false — stable pools would need the flag from registry metadata).
async function quoteSolidly(chainId, tokenIn, tokenOut, amountIn) {
  const v = VENUE_INFRA[chainId]?.find((x) => x.type === 'solidly');
  if (!v || !v.factory) return null;
  if (!(await acquire(chainId))) return null;
  try {
    const r = new ethers.Contract(v.addr, SOLIDLY_ROUTER_ABI, providers[chainId]);
    const out = await r.getAmountsOut.staticCall(amountIn, [
      { from: tokenIn, to: tokenOut, stable: false, factory: v.factory },
    ]);
    return out[1];
  } catch { return null; }
}

async function quoteVenue(chainId, venueKey, tokenIn, tokenOut, amountIn, fee) {
  if (venueKey === 'uniswap-v3') return quoteV3(chainId, tokenIn, tokenOut, amountIn, fee);
  if (venueKey === 'sushiswap-v2' || venueKey === 'velodrome-v2') return quoteV2(chainId, tokenIn, tokenOut, amountIn);
  // fee = tickSpacing for slipstream rows (registry fee_millionths quirk)
  if (venueKey === 'velodrome-slipstream' || venueKey === 'aerodrome-slipstream') return quoteSlipstream(chainId, tokenIn, tokenOut, amountIn, fee);
  if (venueKey === 'aerodrome-v2') return quoteSolidly(chainId, tokenIn, tokenOut, amountIn);
  // Algebra (camelot / aerodrome / velodrome)
  return quoteAlgebra(chainId, tokenIn, tokenOut, amountIn);
}

// ============================================================================
// Discovery refresh (Stage 0): incremental sync + liquidity read
// ============================================================================
let cycleCounter = 0;
async function refreshDiscoveryAndLiquidity(runId) {
  for (const chainId of CHAIN_IDS) {
    // 0a. Incremental sync of new PoolCreated events
    try {
      const nNew = await incrementalSync(providers[chainId], db, chainId, rateLimitFn);
      if (nNew > 0) console.log(`[discovery ${chainId}] +${nNew} new pools from events`);
    } catch (e) {
      console.error(`[discovery ${chainId}] sync error: ${e.message}`);
    }
    // 0b. Algebra probing (Camelot / Aerodrome / Velodrome)
    if (DISCOVERY.algebraProbingEnabled) {
      try {
        const nAlg = await probeAlgebraPools(providers[chainId], db, chainId, rateLimitFn);
        if (nAlg > 0) console.log(`[discovery ${chainId}] +${nAlg} Algebra pools`);
      } catch (e) {
        console.error(`[discovery ${chainId}] algebra probe error: ${e.message}`);
      }
    }
    // 0c. Refresh liquidity snapshots for all registry pools (sampled if too many)
    await refreshLiquidityForChain(chainId, runId);
  }
}

// ============================================================================
// Multicall3 batching for Stage-0 view reads (#56). VERIFIED on the paid
// BlockPi endpoints (2026-08-18): `aggregate` works on all 3 chains,
// `aggregate3` REVERTS — never use it here. `aggregate` reverts on the first
// failing sub-call, so a failed batch falls back to the serial per-pool path.
// ============================================================================
const MULTICALL3 = '0xcA11bde05977b3631167028862bE2a173976CA11';
const MC3_ABI = ['function aggregate((address target, bytes callData)[] calls) payable returns (uint256 blockNumber, bytes[] returnData)'];
const RESERVES_ABI = ['function getReserves() view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)'];
const LIQ_ABI = ['function liquidity() view returns (uint128)'];
const V3_SLOT0_ABI = ['function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16 obsIdx, uint16 obsCard, uint16 obsCardNext, uint8 feeProtocol, bool unlocked)'];
const ALG_STATE_ABI = ['function globalState() view returns (uint160 price, int24 tick, uint16 feeZto, uint16 feeOtz, uint16 timepointIndex, uint8 communityFeeToken0, uint8 communityFeeToken1, bool unlocked)'];
const SLIP_SLOT0_ABI = ['function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, bool unlocked)'];

async function mc3Aggregate(chainId, calls) {
  if (calls.length === 0) return [];
  if (!(await acquire(chainId))) return null;
  try {
    const mc3 = new ethers.Contract(MULTICALL3, MC3_ABI, providers[chainId]);
    const res = await mc3.aggregate.staticCall(calls);
    return res.returnData;
  } catch {
    return null; // whole-batch revert → caller falls back to serial reads
  }
}

// ============================================================================
// Liquidity refresh (Stage 0c) — MC3-batched, full registry (LIMIT 500 removed
// by #56), token0/token1/fee from the registry (no on-chain reads), serial
// fallback per batch. RPC-guard: stop mid-refresh when the cycle's call count
// exceeds P95(24h)×1.5 (#56, review №5 — prioritization, not scheduling).
// ============================================================================
const coldTierSkipped = {}; // chainId → true when the guard tripped this cycle

async function rpcBudgetP95(chainId) {
  try {
    const r = await db.query(
      `SELECT PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY rpc_calls) AS p95
         FROM dry_run_run_stats
        WHERE chain_id = $1 AND source = 'cycle' AND observed_at > now() - interval '24 hours'`,
      [chainId],
    );
    const p95 = Number(r.rows[0]?.p95);
    return Number.isFinite(p95) && p95 > 0 ? p95 : null;
  } catch { return null; }
}

async function computeTvlFromBalances(chainId, token0, token1, reserve0Raw, reserve1Raw) {
  const d0 = (await getErc20Meta(chainId, token0)).decimals;
  const d1 = (await getErc20Meta(chainId, token1)).decimals;
  const p0 = await getPriceUsd(chainId, token0);
  const p1 = await getPriceUsd(chainId, token1);
  if (p0 == null || p1 == null) return null;
  const tvlUsd = (Number(reserve0Raw) / 10 ** d0) * p0 + (Number(reserve1Raw) / 10 ** d1) * p1;
  return tvlUsd;
}

function virtualReserves(liq, sqrtPriceX96) {
  if (liq === 0n) return { reserve0: 0n, reserve1: 0n };
  if (sqrtPriceX96 === 0n) return null;
  return {
    reserve1: (liq * sqrtPriceX96) >> 96n,
    reserve0: (liq << 96n) / sqrtPriceX96,
  };
}

async function refreshLiquidityForChain(chainId, runId) {
  const r = await db.query(
    `SELECT pool_addr, dex, pool_type, token0_addr, token1_addr, fee_millionths
       FROM dry_run_pool_registry WHERE chain_id = $1
       ORDER BY discovered_at DESC`, // #56: LIMIT 500 removed — full registry
    [chainId],
  );
  const budgetP95 = await rpcBudgetP95(chainId);
  const BATCH = 25; // pools per MC3 aggregate (slot0 return ~224B → safe)
  let nEligible = 0;
  let nScanned = 0;
  const t0 = Date.now();
  const metaDec = async (a) => (await getErc20Meta(chainId, a)).decimals;
  const priceUsd = async (a) => getPriceUsd(chainId, a);

  for (let base = 0; base < r.rows.length; base += BATCH) {
    if (budgetP95 && rpcCalls[chainId] > budgetP95 * 1.5) {
      coldTierSkipped[chainId] = true;
      console.log(`[liquidity ${chainId}] RPC-guard: stop at ${nScanned}/${r.rows.length} (rpc=${rpcCalls[chainId]} > P95 ${budgetP95.toFixed(0)}×1.5)`);
      break;
    }
    const batch = r.rows.slice(base, base + BATCH);
    // build the per-pool call plan: v2 → getReserves; v3/slipstream →
    // liquidity+slot0; algebra → liquidity+globalState
    const calls = [];
    const plan = []; // {row, kinds: [...]} aligned with calls
    const iRes = new ethers.Interface(RESERVES_ABI);
    const iLiq = new ethers.Interface(LIQ_ABI);
    const iV3 = new ethers.Interface(V3_SLOT0_ABI);
    const iAlg = new ethers.Interface(ALG_STATE_ABI);
    const iSlip = new ethers.Interface(SLIP_SLOT0_ABI);
    for (const row of batch) {
      if (row.pool_type === 'v2' || row.pool_type === 'solidly-v2') {
        calls.push({ target: row.pool_addr, callData: iRes.encodeFunctionData('getReserves') });
        plan.push({ row, kinds: ['reserves'] });
      } else if (row.pool_type === 'algebra') {
        calls.push({ target: row.pool_addr, callData: iLiq.encodeFunctionData('liquidity') });
        calls.push({ target: row.pool_addr, callData: iAlg.encodeFunctionData('globalState') });
        plan.push({ row, kinds: ['liquidity', 'globalState'] });
      } else { // v3 + slipstream
        calls.push({ target: row.pool_addr, callData: iLiq.encodeFunctionData('liquidity') });
        calls.push({ target: row.pool_addr, callData: (row.pool_type === 'slipstream' ? iSlip : iV3).encodeFunctionData('slot0') });
        plan.push({ row, kinds: ['liquidity', 'slot0'] });
      }
    }
    const out = await mc3Aggregate(chainId, calls);
    let idx = 0;
    for (const p of plan) {
      const row = p.row;
      nScanned += 1;
      if (nScanned % 200 === 0) console.log(`[liquidity ${chainId}] progress ${nScanned}/${r.rows.length} eligible=${nEligible} (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
      try {
        let tvlResult = null;
        if (out) {
          // decode from the batch
          const data = p.kinds.map(() => out[idx]); idx += p.kinds.length;
          if (p.kinds[0] === 'reserves') {
            const dec = iRes.decodeFunctionResult('getReserves', data[0]);
            const tvlUsd = await computeTvlFromBalances(chainId, row.token0_addr, row.token1_addr, dec.reserve0, dec.reserve1);
            if (tvlUsd != null) tvlResult = { tvlUsd, reserve0: dec.reserve0, reserve1: dec.reserve1 };
          } else {
            const liq = iLiq.decodeFunctionResult('liquidity', data[0])[0];
            const state = p.kinds[1] === 'globalState'
              ? iAlg.decodeFunctionResult('globalState', data[1])
              : (row.pool_type === 'slipstream' ? iSlip : iV3).decodeFunctionResult('slot0', data[1]);
            const sqrtPrice = p.kinds[1] === 'globalState' ? state.price : state.sqrtPriceX96;
            const vr = virtualReserves(liq, sqrtPrice);
            if (vr) {
              const tvlUsd = await computeTvlFromBalances(chainId, row.token0_addr, row.token1_addr, vr.reserve0, vr.reserve1);
              if (tvlUsd != null) tvlResult = { tvlUsd, reserve0: vr.reserve0, reserve1: vr.reserve1 };
            }
          }
        } else {
          // batch failed (one bad pool reverts the whole aggregate) → serial path
          idx += p.kinds.length;
          tvlResult = row.pool_type === 'v2' || row.pool_type === 'solidly-v2'
            ? await readPoolTvlV2(providers[chainId], row.pool_addr, metaDec, priceUsd)
            : row.pool_type === 'algebra'
              ? await readPoolTvlAlgebra(providers[chainId], row.pool_addr, metaDec, priceUsd)
              : row.pool_type === 'slipstream'
                ? await readPoolTvlSlipstream(providers[chainId], row.pool_addr, metaDec, priceUsd)
                : await readPoolTvlV3(providers[chainId], row.pool_addr, metaDec, priceUsd);
        }
        if (!tvlResult) continue;
        // Volume read (expensive; PROBE_VOLUME_SAMPLE=N samples every Nth pool, 0=off)
        let volume = null, lastSwapAt = null;
        const volSample = Number(process.env.PROBE_VOLUME_SAMPLE ?? 10);
        if (volSample > 0 && nScanned % volSample === 0) {
          const v = await readPoolVolume24h(providers[chainId], chainId, row.pool_addr, row.pool_type,
            async (a) => (await getErc20Meta(chainId, a)).decimals,
            async (a) => getPriceUsd(chainId, a), rateLimitFn);
          volume = v.volumeUsd; lastSwapAt = v.lastSwapAt;
        }
        const eligible = tvlResult.tvlUsd != null
          && tvlResult.tvlUsd >= FILTER.tvlMinUsd
          && tvlResult.tvlUsd <= FILTER.tvlMaxUsd
          && (volume == null || volume >= FILTER.volume24hMinUsd);
        if (eligible) nEligible += 1;
        await insertLiquiditySnapshot(db, {
          runId, chainId, poolAddr: row.pool_addr, dex: row.dex,
          token0: row.token0_addr, token1: row.token1_addr,
          tvlUsd: tvlResult.tvlUsd, volume24hUsd: volume,
          reserve0: tvlResult.reserve0, reserve1: tvlResult.reserve1,
          lastSwapAt, eligible,
        });
      } catch (e) {
        // skip individual pool failure
      }
    }
  }
  console.log(`[liquidity ${chainId}] scanned=${nScanned}/${r.rows.length} eligible=${nEligible} in ${((Date.now() - t0) / 1000).toFixed(0)}s (range $${FILTER.tvlMinUsd}-$${FILTER.tvlMaxUsd}, MC3 batches of ${BATCH})`);
}

// ============================================================================
// Phase 1: round-trip quotes on eligible cross-DEX pairs
// ============================================================================
async function runCycleDex(runId) {
  let nObs = 0;
  for (const chainId of CHAIN_IDS) {
    const eligible = await getEligibleCrossDexPairs(db, chainId, FILTER.tvlMinUsd, FILTER.tvlMaxUsd);
    if (eligible.length === 0) {
      console.log(`[dex ${chainId}] no eligible cross-DEX pairs yet (need discovery + liquidity refresh first)`);
      continue;
    }
    console.log(`[dex ${chainId}] ${eligible.length} eligible cross-DEX pairs`);
    for (const pair of eligible) {
      const tokenA = pair.token0_addr;
      const tokenB = pair.token1_addr;
      const dexes = pair.dexes;
      const poolAddrs = pair.pool_addrs;
      const fees = pair.fees;
      // Get USD price for tokenA to size notionals
      const priceA = await getPriceUsd(chainId, tokenA);
      if (priceA == null) continue;
      const metaA = await getErc20Meta(chainId, tokenA);
      const metaB = await getErc20Meta(chainId, tokenB);
      // Pool addresses by dex for the metadata column
      const poolByDex = {};
      for (let i = 0; i < dexes.length; i++) {
        poolByDex[dexes[i]] = { addr: poolAddrs[i], fee: fees[i] };
      }
      for (const usd of PHASE1_NOTIONALS) {
        const amountInA = ethers.parseUnits((usd / priceA).toFixed(Math.min(metaA.decimals, 8)), metaA.decimals);
        // Buy leg: tokenA → tokenB on each dex (in parallel)
        const fwd = {};
        await Promise.all(dexes.map(async (d) => {
          const fee = poolByDex[d]?.fee ? Number(poolByDex[d].fee) : 500;
          fwd[d] = await quoteVenue(chainId, d, tokenA, tokenB, amountInA, fee);
        }));
        // Sell leg: for each buy dex X with non-zero fwd, sell tokenB → tokenA on each other dex Y
        for (const dx of dexes) {
          const bAmt = fwd[dx];
          if (!bAmt || bAmt === 0n) continue;
          const revPerY = {};
          await Promise.all(dexes.map(async (dy) => {
            if (dy === dx) return;
            const fee = poolByDex[dy]?.fee ? Number(poolByDex[dy].fee) : 500;
            revPerY[dy] = await quoteVenue(chainId, dy, tokenB, tokenA, bAmt, fee);
          }));
          for (const dy of dexes) {
            if (dy === dx) continue;
            const back = revPerY[dy];
            if (!back) continue;
            const bps = Number((back - amountInA) * 10000n / amountInA);
            try {
              await db.query(
                `INSERT INTO dry_run_dex_observations
                   (run_id, chain_id, buy_venue, sell_venue, token_in, token_out,
                    token_in_addr, token_out_addr, notional_usd, amount_in,
                    amount_out_buy, amount_final, round_trip_bps, gas_cost_usd, rpc_node, metadata)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
                [
                  runId, chainId, dx, dy,
                  metaA.symbol ?? tokenA.slice(0, 10), metaB.symbol ?? tokenB.slice(0, 10),
                  tokenA, tokenB,
                  usd, amountInA.toString(),
                  bAmt.toString(), back.toString(),
                  bps, null, rpcLabels[chainId],
                  JSON.stringify({ buyPool: poolByDex[dx], sellPool: poolByDex[dy] }),
                ],
              );
              nObs += 1;
            } catch (e) {
              console.error(`[dex insert ${chainId}] ${e.message.slice(0, 100)}`);
            }
          }
        }
      }
    }
  }
  return nObs;
}

// ============================================================================
// Phase 2: cross-chain price gaps
// ============================================================================
// Token identity across chains: canonical map first (config.canonicalTokens —
// verified addresses per chain), symbol fallback with heuristic gates. Rows
// carry metadata.trust = 'canonical' | 'heuristic' | 'suspicious' so SQL
// analysis can weigh false-match risk (same-symbol different-asset collisions
// are common in the low/mid-liquidity long tail).
function buildCanonicalIndex() {
  const idx = {}; // `${chainId}:${addrLower}` -> canonical asset key
  for (const [sym, perChain] of Object.entries(config.canonicalTokens ?? {})) {
    if (sym.startsWith('_')) continue;
    for (const [cid, addr] of Object.entries(perChain)) {
      idx[`${cid}:${String(addr).toLowerCase()}`] = sym;
    }
  }
  return idx;
}

async function runCycleCrossChain(runId) {
  let nObs = 0;
  const sanityBreaches = [];
  const canonIndex = buildCanonicalIndex();
  // Universe: tokens in ANY pool position (token0 OR token1 — a token that is
  // always token1 was previously invisible) whose LATEST liquidity snapshot is
  // eligible. Since #52 the query also carries per-token context recorded at
  // insert time: max latest TVL among the token's eligible pools (v1 proxy for
  // the quoting venue's depth) and the newest pool's created_at_block (age).
  const r = await db.query(
    `WITH latest_snap AS (
         SELECT DISTINCT ON (chain_id, pool_addr) chain_id, pool_addr, eligible, tvl_usd
           FROM dry_run_liquidity_snapshots
          ORDER BY chain_id, pool_addr, observed_at DESC
       ),
       elig_pools AS (
         SELECT p.chain_id, p.token0_addr, p.token0_symbol, p.token1_addr, p.token1_symbol,
                s.tvl_usd, p.created_at_block
           FROM dry_run_pool_registry p
           JOIN latest_snap s ON s.chain_id = p.chain_id AND s.pool_addr = p.pool_addr
          WHERE s.eligible = TRUE
       ),
       tokens AS (
         SELECT chain_id, addr, symbol, MAX(tvl_usd) AS token_tvl, MAX(created_at_block) AS newest_block
           FROM (
             SELECT chain_id, token0_addr AS addr, token0_symbol AS symbol, tvl_usd, created_at_block FROM elig_pools WHERE token0_symbol IS NOT NULL
             UNION ALL
             SELECT chain_id, token1_addr AS addr, token1_symbol AS symbol, tvl_usd, created_at_block FROM elig_pools WHERE token1_symbol IS NOT NULL
           ) t
          GROUP BY chain_id, addr, symbol
       )
       SELECT DISTINCT ON (chain_id, addr) chain_id, addr, symbol, token_tvl, newest_block FROM tokens`,
  );
  // groupKey -> { canonical, collision, chains: { [chainId]: {addr, priceUsd, symbol} } }
  const groups = {};
  for (const row of r.rows) {
    const chainId = Number(row.chain_id);
    const p = await getPriceUsd(chainId, row.addr);
    // Broken/garbage quotes (scam-token 1-unit pricing) produce absurd or
    // non-finite USD prices — they would overflow the NUMERIC(20,8) columns
    // ("numeric field overflow") and are meaningless as price-gap signal.
    // 1e9 is far above any legit token price and safely below the column
    // limit (NUMERIC(20,8) tops out at ~1e12).
    if (p == null || !Number.isFinite(p) || p <= 0 || p > 1e9) continue;
    const canonSym = canonIndex[`${chainId}:${row.addr.toLowerCase()}`] ?? null;
    const gk = canonSym ?? `sym:${row.symbol}`;
    groups[gk] ??= { canonical: canonSym != null, collision: false, chains: {} };
    const g = groups[gk];
    // Two different addresses on one chain mapped to the same group = symbol
    // collision — the group cannot be trusted as a single asset.
    if (g.chains[chainId] && g.chains[chainId].addr.toLowerCase() !== row.addr.toLowerCase()) {
      g.collision = true;
    }
    g.chains[chainId] = {
      addr: row.addr, priceUsd: p, symbol: row.symbol,
      tokenTvl: row.token_tvl == null ? null : Number(row.token_tvl),
      newestBlock: row.newest_block == null ? null : Number(row.newest_block),
    };
  }
  // Hot prioritization (#56, review №5): tokens with open windows quote first —
  // ordering inside the cycle, not a separate schedule.
  let openAddrSet = new Set();
  try {
    const ow = await db.query(`SELECT DISTINCT token_addr_buy AS a, token_addr_sell AS b FROM dry_run_arb_opportunities WHERE status = 'open'`);
    for (const row of ow.rows) { openAddrSet.add(row.a.toLowerCase()); openAddrSet.add(row.b.toLowerCase()); }
  } catch { /* table may not exist yet */ }
  const groupEntries = Object.entries(groups).sort(([_, ga], [__, gb]) => {
    const hot = (g) => Object.values(g.chains).some((c) => openAddrSet.has(c.addr.toLowerCase())) ? 0 : 1;
    return hot(ga) - hot(gb);
  });
  for (const [gk, g] of groupEntries) {
    const onChains = Object.keys(g.chains).map(Number);
    if (onChains.length < 2) continue;
    for (let i = 0; i < onChains.length; i++) {
      for (let j = 0; j < onChains.length; j++) {
        if (i === j) continue;
        const buyChain = onChains[i];
        const sellChain = onChains[j];
        const buy = g.chains[buyChain];
        const sell = g.chains[sellChain];
        const priceDiffBps = ((sell.priceUsd - buy.priceUsd) / buy.priceUsd) * 10000;
        // NUMERIC(10,4) tops at 99999.9999 — the historical guard (≥999999) let
        // 100K–1M bps scam gaps through and every such INSERT died with
        // "numeric field overflow". Guard against the column limit, not 10× it.
        if (!Number.isFinite(priceDiffBps) || Math.abs(priceDiffBps) >= 99999) continue;
        const meta = await getErc20Meta(buyChain, buy.addr);
        // Trust level for this group's observations
        let trust = g.canonical && !g.collision ? 'canonical' : 'heuristic';
        let trustMeta = { group: g.canonical ? gk : buy.symbol };
        if (!g.canonical || g.collision) {
          const [metaBuy, metaSell] = await Promise.all([
            getErc20Meta(buyChain, buy.addr), getErc20Meta(sellChain, sell.addr),
          ]);
          const decimalsOk = metaBuy.decimals === metaSell.decimals;
          const gapOk = Math.abs(priceDiffBps) <= (config.crossChain?.maxHeuristicGapBps ?? 2500);
          trust = decimalsOk && gapOk && !g.collision ? 'heuristic' : 'suspicious';
          trustMeta = {
            group: buy.symbol, decimalsOk, gapOk, collision: g.collision,
            decimalsBuy: metaBuy.decimals, decimalsSell: metaSell.decimals,
          };
        }
        for (const usd of PHASE2_NOTIONALS) {
          const amountInRaw = ethers.parseUnits((usd / buy.priceUsd).toFixed(Math.min(meta.decimals, 8)), meta.decimals);
          // Real bridge fee via the PUBLIC Across suggested-fees API (no key)
          const across = await acrossFeeCached(buyChain, sellChain, buy.addr, sell.addr, usd, amountInRaw);
          let bridgeFeeUsd = null, bridgeFeeBps = null, finalitySeconds = null, bridgeMeta = null;
          if (across && across.feeBps != null && Number.isFinite(across.feeBps)) {
            bridgeFeeBps = across.feeBps;
            bridgeFeeUsd = (usd * across.feeBps) / 10000;
            finalitySeconds = across.finalitySeconds;
            bridgeMeta = { across: { feeBps: across.feeBps, isAmountTooLow: across.isAmountTooLow } };
          }
          const netEdgeBps = bridgeFeeBps != null ? priceDiffBps - bridgeFeeBps : priceDiffBps;
          // Executable depth: USDC -> token (buy chain) -> bridge -> token ->
          // USDC (sell chain), quoted at REAL notional. This is the honest
          // cross-chain round-trip; the marginal price_diff_bps above stays
          // for continuity. Skipped for 'suspicious' groups (known garbage).
          let exec = null;
          if (trust !== 'suspicious') {
            const units = await quoteUsdToUnits(buyChain, buy.addr, usd);
            if (units && units > 0n) {
              const feeScale = bridgeFeeBps != null ? 100000n - BigInt(Math.round(bridgeFeeBps * 10)) : 100000n;
              const unitsAfterBridge = (units * feeScale) / 100000n;
              const sellUsdOut = await quoteUnitsToUsd(sellChain, sell.addr, unitsAfterBridge);
              if (sellUsdOut != null && Number.isFinite(sellUsdOut)) {
                exec = {
                  usd_in: usd,
                  units_bought: units.toString(),
                  units_after_bridge: unitsAfterBridge.toString(),
                  sell_usd_out: Number(sellUsdOut.toFixed(6)),
                  bridge_fee_bps: bridgeFeeBps,
                  net_bps: Number((((sellUsdOut - usd) / usd) * 10000).toFixed(4)),
                };
              }
            }
          }
          // exec_pp (#52): pre-positioned dual-leg at the same notional, NO
          // bridge — the metric of the operator's strategy. Legs quote through
          // the first working venue (UniV3 500 → 3000 → algebra → slipstream
          // ts=100 → solidly); first-success keeps the RPC budget bounded and
          // is conservative (a deeper non-first venue could only improve the
          // sell side). Venue recorded for the FilterLab venue_pair axis.
          let netPpBps = null;
          let execPp = null;
          if (trust !== 'suspicious') {
            const buyLeg = await quoteUsdToUnitsBest(buyChain, buy.addr, usd);
            if (buyLeg) {
              const sellLeg = await quoteUnitsToUsdBest(sellChain, sell.addr, buyLeg.amount);
              if (sellLeg) {
                const gasBpsBuy = await legGasBps(buyChain, usd);
                const gasBpsSell = await legGasBps(sellChain, usd);
                if (gasBpsBuy != null && gasBpsSell != null) {
                  const pp = computeNetPpBps({ usdIn: usd, usdOut: sellLeg.usdOut, gasBpsBuy, gasBpsSell });
                  netPpBps = pp.netPpBps;
                  execPp = {
                    usd_in: usd,
                    units: buyLeg.amount.toString(),
                    sell_usd_out: Number(sellLeg.usdOut.toFixed(6)),
                    venue_buy: buyLeg.venue,
                    venue_sell: sellLeg.venue,
                    gas_bps_buy: Number(gasBpsBuy.toFixed(2)),
                    gas_bps_sell: Number(gasBpsSell.toFixed(2)),
                    ...(pp.clamped ? { net_pp_raw: pp.raw } : {}),
                  };
                  // Non-blocking sanity (operator decision №3): canonical
                  // WETH/USDC at $50/$100 outside ±50 bps → alert line only.
                  if (g.canonical && !g.collision && ['WETH', 'USDC'].includes(buy.symbol)
                    && (usd === 50 || usd === 100) && Math.abs(netPpBps) > 50) {
                    sanityBreaches.push(`${buy.symbol} ${buyChain}>${sellChain} $${usd}: ${netPpBps.toFixed(1)} bps`);
                  }
                }
              }
            }
          }
          // Context at insert (#52, 0 extra RPC): TVL proxy (max over the
          // token's eligible pools — v1 proxy for quoting-venue depth), band,
          // pool age from the newest pool's created_at_block, leg blocks.
          const tvlBuy = buy.tokenTvl ?? null;
          const tvlSell = sell.tokenTvl ?? null;
          const tvlKnown = [tvlBuy, tvlSell].filter((x) => x != null);
          const tvlMin = tvlKnown.length ? Math.min(...tvlKnown) : null;
          const tvlBand = tvlMin == null ? null
            : tvlMin < 1e3 ? '<1K' : tvlMin < 1e4 ? '1K-10K' : tvlMin < 1e5 ? '10K-100K'
            : tvlMin < 1e6 ? '100K-1M' : tvlMin < 5e6 ? '1M-5M' : tvlMin < 2e7 ? '5M-20M' : '>20M';
          const ageHoursOf = (chainId, newestBlock) => {
            const gs = chainGas[chainId];
            if (newestBlock == null || !gs?.blockNumber) return null;
            return Number((Math.max(0, gs.blockNumber - newestBlock) * (BLOCK_TIME_SEC[chainId] ?? 2) / 3600).toFixed(1));
          };
          try {
            await db.query(
              `INSERT INTO dry_run_cross_chain_observations
                 (run_id, token, token_addr_buy_chain, token_addr_sell_chain,
                  buy_chain_id, sell_chain_id, notional_usd,
                  price_buy_usd, price_sell_usd, price_diff_bps,
                  bridge_protocol, bridge_fee_usd, bridge_fee_bps,
                  bridge_finality_seconds, net_edge_bps, metadata, net_pp_bps)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
              [
                runId, buy.symbol, buy.addr, sell.addr, buyChain, sellChain, usd,
                buy.priceUsd, sell.priceUsd, Number(priceDiffBps.toFixed(4)),
                across ? 'across' : 'none',
                bridgeFeeUsd != null ? Number(bridgeFeeUsd.toFixed(6)) : null,
                bridgeFeeBps != null ? Number(bridgeFeeBps.toFixed(4)) : null,
                finalitySeconds, Number(netEdgeBps.toFixed(4)),
                JSON.stringify({
                  trust, ...trustMeta, exec, exec_pp: execPp,
                  ...(execPp ? {
                    venue_buy: execPp.venue_buy,
                    venue_sell: execPp.venue_sell,
                    venue_pair: `${execPp.venue_buy}>${execPp.venue_sell}`,
                    gas_bps_buy: execPp.gas_bps_buy,
                    gas_bps_sell: execPp.gas_bps_sell,
                    // approximate blocks (review №9): the cycle's sampled block
                    // per chain — eth_call does not return the quote's block
                    block_buy: chainGas[buyChain]?.blockNumber ?? null,
                    block_sell: chainGas[sellChain]?.blockNumber ?? null,
                  } : {}),
                  token_tvl_buy_usd: tvlBuy,
                  token_tvl_sell_usd: tvlSell,
                  tvl_band: tvlBand,
                  pool_age_hours_buy: ageHoursOf(buyChain, buy.newestBlock),
                  pool_age_hours_sell: ageHoursOf(sellChain, sell.newestBlock),
                  ...(bridgeMeta ?? { note: 'across fee unavailable' }),
                }),
                netPpBps,
              ],
            );
            nObs += 1;
          } catch (e) {
            console.error(`[cc insert] ${e.message.slice(0, 100)}`);
          }
        }
      }
    }
  }
  for (const s of sanityBreaches) {
    console.log(`[sanity] CANONICAL OFF-BAND (non-blocking, decision №3): ${s}`);
  }
  return nObs;
}

// ============================================================================
// Best-venue leg quotes for exec_pp (#52): first working venue on the ladder.
// QuoterV2 is non-view → each hop is one rate-limited staticCall; the ladder
// stops at the first success so a token living only on Aerodrome/Velodrome
// costs ~4 calls per leg instead of the whole ladder.
// ============================================================================
async function quoteUsdToUnitsBest(chainId, tokenAddr, usd) {
  const usdc = config.chains[chainId].seedTokens.USDC.addr;
  const usdRaw = BigInt(Math.round(usd * 1e6));
  const ladder = [
    ['uniswap-v3:500', () => quoteV3(chainId, usdc, tokenAddr, usdRaw, 500)],
    ['uniswap-v3:3000', () => quoteV3(chainId, usdc, tokenAddr, usdRaw, 3000)],
    ['algebra', () => quoteAlgebra(chainId, usdc, tokenAddr, usdRaw)],
    ['slipstream:100', () => quoteSlipstream(chainId, usdc, tokenAddr, usdRaw, 100)],
    ['solidly', () => quoteSolidly(chainId, usdc, tokenAddr, usdRaw)],
  ];
  for (const [venue, fn] of ladder) {
    const out = await fn().catch(() => null);
    if (out && out > 0n) return { venue, amount: out };
  }
  // WETH two-hop fallback for thin long-tail without a direct USDC pool
  // (e.g. WBTC on OP): USDC → WETH → token, both 0.05% hops.
  const weth = config.chains[chainId].seedTokens.WETH.addr;
  const wOut = await quoteV3(chainId, usdc, weth, usdRaw, 500).catch(() => null);
  if (wOut && wOut > 0n) {
    const tOut = await quoteV3(chainId, weth, tokenAddr, wOut, 500).catch(() => null);
    if (tOut && tOut > 0n) return { venue: 'uniswap-v3:500>weth', amount: tOut };
  }
  return null;
}

async function quoteUnitsToUsdBest(chainId, tokenAddr, amountRaw) {
  const usdc = config.chains[chainId].seedTokens.USDC.addr;
  const ladder = [
    ['uniswap-v3:500', () => quoteV3(chainId, tokenAddr, usdc, amountRaw, 500)],
    ['uniswap-v3:3000', () => quoteV3(chainId, tokenAddr, usdc, amountRaw, 3000)],
    ['algebra', () => quoteAlgebra(chainId, tokenAddr, usdc, amountRaw)],
    ['slipstream:100', () => quoteSlipstream(chainId, tokenAddr, usdc, amountRaw, 100)],
    ['solidly', () => quoteSolidly(chainId, tokenAddr, usdc, amountRaw)],
  ];
  for (const [venue, fn] of ladder) {
    const out = await fn().catch(() => null);
    if (out && out > 0n) return { venue, usdOut: Number(ethers.formatUnits(out, 6)) };
  }
  // WETH two-hop fallback for thin long-tail
  const weth = config.chains[chainId].seedTokens.WETH.addr;
  const w = await quoteV3(chainId, tokenAddr, weth, amountRaw, 500).catch(() => null);
  if (w && w > 0n) {
    const u = await quoteV3(chainId, weth, usdc, w, 500).catch(() => null);
    if (u && u > 0n) return { venue: 'uniswap-v3:500>weth', usdOut: Number(ethers.formatUnits(u, 6)) };
  }
  return null;
}

// ============================================================================
// Stage 3 (#53): opportunity windows — pure-SQL detection over the just-written
// run_id (0 RPC), pre-aggregated per route (review №4) before the UPSERT.
// ============================================================================
async function runStage3Opportunities(runId) {
  const minBps = Number(OPPORTUNITY_CFG.minNetPpbps ?? 0);
  const windowMinutes = Number(OPPORTUNITY_CFG.windowMinutes ?? 30);
  const r = await db.query(
    `SELECT token, token_addr_buy_chain, token_addr_sell_chain, buy_chain_id, sell_chain_id,
            notional_usd, net_pp_bps, bridge_fee_bps, observed_at, metadata
       FROM dry_run_cross_chain_observations
      WHERE run_id = $1 AND net_pp_bps > $2 AND notional_usd IN (50, 100, 1000)
        AND COALESCE(metadata->>'trust', '') <> 'suspicious'`,
    [runId, minBps],
  );
  const routes = aggregateObservations(r.rows, { minNetBps: minBps });
  let n = 0;
  for (const rt of routes) {
    if (!rt.opensWindow) {
      // $1000-only positive (depth): never opens, never extends last_seen —
      // only appends depth to an already-open window (decision №1 / review №3).
      await db.query(
        `UPDATE dry_run_arb_opportunities o
            SET net_bps_at_1000 = $3,
                max_notional_positive = GREATEST(o.max_notional_positive, 1000)
          WHERE o.status = 'open'
            AND o.token_addr_buy = $1 AND o.token_addr_sell = $2
            AND o.buy_chain_id = $4 AND o.sell_chain_id = $5`,
        [rt.tokenAddrBuy, rt.tokenAddrSell, rt.at[1000], rt.buyChainId, rt.sellChainId],
      );
      continue;
    }
    await db.query(
      `INSERT INTO dry_run_arb_opportunities
         (token, token_addr_buy, token_addr_sell, buy_chain_id, sell_chain_id, trust,
          first_seen, last_seen, samples, run_ids, net_bps_at_50, net_bps_at_100, net_bps_at_1000,
          gas_bps_last, best_net_bps, best_notional_usd, max_notional_positive, venue_pair,
          bridge_fee_bps_last, tvl_buy_usd_last, tvl_sell_usd_last, status)
       VALUES ($1,$2,$3,$4,$5,$6, now(), now(), $7, ARRAY[$8], $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, 'open')
       ON CONFLICT (token_addr_buy, token_addr_sell, buy_chain_id, sell_chain_id) WHERE status = 'open'
       DO UPDATE SET
         last_seen = now(),
         samples = dry_run_arb_opportunities.samples + EXCLUDED.samples,
         run_ids = (SELECT COALESCE(array_agg(DISTINCT x), '{}') FROM unnest(dry_run_arb_opportunities.run_ids || EXCLUDED.run_ids) AS x),
         net_bps_at_50 = COALESCE(EXCLUDED.net_bps_at_50, dry_run_arb_opportunities.net_bps_at_50),
         net_bps_at_100 = COALESCE(EXCLUDED.net_bps_at_100, dry_run_arb_opportunities.net_bps_at_100),
         net_bps_at_1000 = COALESCE(EXCLUDED.net_bps_at_1000, dry_run_arb_opportunities.net_bps_at_1000),
         gas_bps_last = EXCLUDED.gas_bps_last,
         best_net_bps = GREATEST(dry_run_arb_opportunities.best_net_bps, EXCLUDED.best_net_bps),
         best_notional_usd = CASE WHEN EXCLUDED.best_net_bps >= dry_run_arb_opportunities.best_net_bps
                             THEN EXCLUDED.best_notional_usd ELSE dry_run_arb_opportunities.best_notional_usd END,
         max_notional_positive = GREATEST(dry_run_arb_opportunities.max_notional_positive, EXCLUDED.max_notional_positive),
         venue_pair = EXCLUDED.venue_pair,
         bridge_fee_bps_last = EXCLUDED.bridge_fee_bps_last,
         tvl_buy_usd_last = EXCLUDED.tvl_buy_usd_last,
         tvl_sell_usd_last = EXCLUDED.tvl_sell_usd_last`,
      [rt.token, rt.tokenAddrBuy, rt.tokenAddrSell, rt.buyChainId, rt.sellChainId, rt.trust,
       rt.samples, runId, rt.at[50] ?? null, rt.at[100] ?? null, rt.at[1000] ?? null,
       rt.gasBpsLast, rt.bestNetBps, rt.bestNotionalUsd,
       rt.maxNotionalPositive ?? rt.bestNotionalUsd,
       rt.venuePair, rt.bridgeFeeBpsLast, rt.tvlBuyUsdLast, rt.tvlSellUsdLast],
    );
    n += 1;
  }
  // Expire: open windows not re-seen within the gap (calibrated on OVER bursts).
  const exp = await db.query(
    `UPDATE dry_run_arb_opportunities SET status = 'expired', expired_at = now()
      WHERE status = 'open' AND last_seen < now() - make_interval(mins => $1)
      RETURNING id`,
    [windowMinutes],
  );
  if (n > 0 || exp.rowCount > 0) {
    console.log(`[stage3] upserted=${n} expired=${exp.rowCount}`);
  }
  return n;
}

async function fetchAcrossFee(buyChainId, sellChainId, tokenAddrBuy, tokenAddrSell, amountInRaw) {
  // Public suggested-fees endpoint — NO API key required (verified 2026-08-15
  // from the probe host). Fee percentages come back 1e18-scaled (1e18 = 100%).
  const url = new URL(`${ACROSS_API_BASE}/suggested-fees`);
  url.searchParams.set('inputToken', tokenAddrBuy);
  url.searchParams.set('outputToken', tokenAddrSell);
  url.searchParams.set('originChainId', String(buyChainId));
  url.searchParams.set('destinationChainId', String(sellChainId));
  url.searchParams.set('amount', amountInRaw.toString());
  url.searchParams.set('recipient', '0x0000000000000000000000000000000000000001');
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    const j = await r.json();
    const pctSum = (BigInt(j.relayFeePct ?? 0) + BigInt(j.capitalFeePct ?? 0) + BigInt(j.lpFeePct ?? 0));
    // x10 fixed-point before the integer division so sub-bps precision survives
    const feeBps = Number((pctSum * 1_000_000n) / 10n ** 18n) / 100;
    return {
      feeBps,
      finalitySeconds: j.estimatedFillTimeSec != null ? Number(j.estimatedFillTimeSec) : null,
      isAmountTooLow: j.isAmountTooLow === true,
      raw: j,
    };
  } catch { return null; }
}

// Across fee cache: (token, route, notional-usd) → fee, TTL 10 min. Amounts
// drift with prices between cycles, but the fee curve is smooth — per-USD
// caching keeps API volume low without losing precision that matters.
const acrossFeeCache = new Map();
const ACROSS_CACHE_TTL_MS = 10 * 60_000;
async function acrossFeeCached(buyChainId, sellChainId, tokenBuy, tokenSell, usd, amountInRaw) {
  const key = `${tokenBuy.toLowerCase()}|${buyChainId}>${sellChainId}|${usd}`;
  const hit = acrossFeeCache.get(key);
  if (hit && Date.now() - hit.ts < ACROSS_CACHE_TTL_MS) return hit.fee;
  const fee = await fetchAcrossFee(buyChainId, sellChainId, tokenBuy, tokenSell, amountInRaw);
  acrossFeeCache.set(key, { ts: Date.now(), fee });
  return fee;
}

// ============================================================================
// Executable-depth helpers: quote at REAL notional instead of the marginal
// 1-unit price. Cross-chain "gaps" measured at 1 unit produced phantom
// opportunities from thin pools (WBTC +24000 bps artifact 2026-08-15).
// ============================================================================
async function quoteUsdToUnits(chainId, tokenAddr, usd) {
  // USDC -> token on the buy chain; returns raw token units (or null)
  const usdc = config.chains[chainId].seedTokens.USDC.addr;
  const usdRaw = BigInt(Math.round(usd * 1e6));
  for (const fee of [500, 3000]) {
    const out = await quoteV3(chainId, usdc, tokenAddr, usdRaw, fee);
    if (out && out > 0n) return out;
  }
  return null;
}

async function quoteUnitsToUsd(chainId, tokenAddr, amountRaw) {
  // token -> USDC on the sell chain; returns USD (or null)
  const usdc = config.chains[chainId].seedTokens.USDC.addr;
  for (const fee of [500, 3000]) {
    const out = await quoteV3(chainId, tokenAddr, usdc, amountRaw, fee);
    if (out && out > 0n) return Number(ethers.formatUnits(out, 6));
  }
  const weth = config.chains[chainId].seedTokens.WETH.addr;
  const w = await quoteV3(chainId, tokenAddr, weth, amountRaw, 500).catch(() => null)
    ?? await quoteAlgebra(chainId, tokenAddr, weth, amountRaw)
    ?? await quoteSlipstreamAnyTs(chainId, tokenAddr, weth, amountRaw)
    ?? await quoteSolidly(chainId, tokenAddr, weth, amountRaw);
  if (w && w > 0n) {
    const u = await quoteV3(chainId, weth, usdc, w, 500);
    if (u && u > 0n) return Number(ethers.formatUnits(u, 6));
  }
  return null;
}

// ============================================================================
// Main loop
// ============================================================================
async function runOnce() {
  const runId = randomUUID();
  const t0 = Date.now();
  cycleCounter += 1;
  for (const id of CHAIN_IDS) { rpcCalls[id] = 0; delete coldTierSkipped[id]; }
  console.log(`[${new Date().toISOString()}] run ${runId} starting (cycle ${cycleCounter})`);
  // Gas sample first (#52): exec_pp legs need gas + cycle block before quoting.
  for (const chainId of CHAIN_IDS) {
    try { await sampleChainGas(chainId); } catch (e) { console.error(`[gas ${chainId}] ${e.message}`); }
  }
  // Stage 0: discovery refresh every Nth cycle (or always on cycle 1)
  if (cycleCounter === 1 || cycleCounter % DISCOVERY.refreshIntervalCycles === 0) {
    try { await refreshDiscoveryAndLiquidity(runId); } catch (e) { console.error(`[stage0] ${e.message}`); }
  }
  // Stage 1: cross-DEX round-trips
  let dexN = 0;
  try { dexN = await runCycleDex(runId); } catch (e) { console.error(`[dex cycle] ${e.message}`); }
  // Stage 2: cross-chain
  let ccN = 0;
  try { ccN = await runCycleCrossChain(runId); } catch (e) { console.error(`[cc cycle] ${e.message}`); }
  // Stage 3 (#53): opportunity windows over the just-written run
  let oppN = 0;
  try { oppN = await runStage3Opportunities(runId); } catch (e) { console.error(`[stage3] ${e.message}`); }
  // run_stats telemetry (#52)
  try { await persistRunStats(runId, Date.now() - t0); } catch { /* logged inside */ }
  const dur = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`[${new Date().toISOString()}] run ${runId} done — dex=${dexN} cross-chain=${ccN} opp-upserted=${oppN} in ${dur}s`);
}

async function bootstrap() {
  // Apply backfill if registry is empty OR --backfill flag is set
  for (const chainId of CHAIN_IDS) {
    const r = await db.query('SELECT COUNT(*) AS n FROM dry_run_pool_registry WHERE chain_id = $1', [chainId]);
    const n = Number(r.rows[0].n);
    if (n === 0 || FORCE_BACKFILL) {
      console.log(`[bootstrap ${chainId}] registry has ${n} pools — running backfill (${DISCOVERY.backfillBlocks} blocks)...`);
      await backfillPools(providers[chainId], db, chainId, DISCOVERY.backfillBlocks, rateLimitFn);
    } else {
      console.log(`[bootstrap ${chainId}] registry has ${n} pools — skipping backfill`);
    }
  }
}

async function main() {
  console.log(`# Discovery-driven dry-run probe`);
  console.log(`# Chains: ${CHAIN_IDS.map((id) => `${config.chains[id].name}(${id})`).join(', ')}`);
  console.log(`# Filter: $${FILTER.tvlMinUsd}-$${FILTER.tvlMaxUsd} TVL, $${FILTER.volume24hMinUsd} 24h vol min`);
  console.log(`# Notionals: phase1=${JSON.stringify(PHASE1_NOTIONALS)} phase2=${JSON.stringify(PHASE2_NOTIONALS)}`);
  console.log(`# Opportunity (#53): net_pp_bps > ${OPPORTUNITY_CFG.minNetPpbps ?? 0} on $50/$100, window ${OPPORTUNITY_CFG.windowMinutes ?? 30} min`);
  console.log(`# Period: ${PERIOD_SEC}s  Rate limit: ${RATE_LIMIT_RPS} rps/chain`);
  console.log(`# Backfill blocks: ${DISCOVERY.backfillBlocks}  Refresh every: ${DISCOVERY.refreshIntervalCycles} cycles`);
  console.log(`# Across API: public (no key)  Mode: ${CONTINUOUS ? 'continuous' : 'single cycle'}`);
  console.log();

  try { await db.query('SELECT 1'); } catch (e) {
    console.error(`DB connection failed: ${e.message}`);
    process.exit(1);
  }
  const r = await db.query(
    `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='dry_run_pool_registry') AS reg,
            EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='dry_run_dex_observations') AS dex,
            EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='dry_run_liquidity_snapshots') AS liq`,
  );
  if (!r.rows[0].reg || !r.rows[0].dex || !r.rows[0].liq) {
    console.error('dry_run_* tables missing — apply migrations 055 + 056 first: npm run db:migrate');
    process.exit(1);
  }

  await bootstrap();
  await runOnce();
  if (!CONTINUOUS) {
    await db.end();
    return;
  }

  console.log(`\n# Looping every ${PERIOD_SEC}s. SIGINT/SIGTERM to stop.\n`);
  // A full cycle (liquidity refresh + quotes) can take far longer than
  // PERIOD_SEC — a naive setInterval would stack up to N overlapping cycles,
  // exhausting the RPC budget and the pg pool. Skip ticks while a cycle is
  // still running.
  // NB: the interval must NOT be unref'd — with no other active handles the
  // process exits cleanly right after each cycle and pm2 restarts it (the
  // 148-restart loop observed on the Aéza host; error log stays empty).
  let busy = false;
  const handle = setInterval(() => {
    if (busy) return;
    busy = true;
    runOnce()
      .catch((e) => console.error(`[runOnce] ${e.message}`))
      .finally(() => { busy = false; });
  }, PERIOD_SEC * 1000);

  const shutdown = async (sig) => {
    console.log(`\n[${sig}] shutting down gracefully...`);
    clearInterval(handle);
    try { await db.end(); } catch {}
    process.exit(0);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((e) => {
  console.error('Probe failed:', e);
  process.exit(1);
});
