#!/usr/bin/env node
/**
 * Multi-chain continuous dry-run arbitrage probe — discovery-driven.
 *
 * Replaces the hardcoded token universe with autonomous on-chain discovery:
 *   1. Factory event sync (Uniswap V3 PoolCreated + Sushi V2 PairCreated) +
 *      Algebra probing (Camelot / Aerodrome / Velodrome Slipstream).
 *   2. Liquidity filter: read TVL (virtual reserves) + 24h Swap-event volume
 *      for every discovered pool, persist into dry_run_liquidity_snapshots,
 *      mark pools with $10K ≤ TVL ≤ $500K as `eligible`.
 *   3. Quote cycle (Phase 1): round-trip quotes for every eligible
 *      cross-DEX pair (tokenA, tokenB where ≥2 DEXes have eligible pools).
 *   4. Cross-chain cycle (Phase 2): price gaps for tokens liquid on ≥2 chains.
 *
 * Targeting LOW/MEDIUM liquidity ($10K–$5M TVL, see probe-config.json
 * filter.tvlMinUsd/tvlMaxUsd) — high-liquidity pools (WETH/USDC etc.) are
 * arbed to zero by well-capitalized bots; the edge, if any, lives in pools
 * below their radar. The filter is the user's explicit ask — it makes
 * "maximally wide observation" tractable without flooding the dataset with
 * dust/scam pools.
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
 * Optional (Phase 2 bridge-fee enrichment):
 *   ACROSS_API_KEY=... ACROSS_INTEGRATOR_ID=... node tools/probe-dry-run.mjs --continuous
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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = path.join(__dirname, 'probe-config.json');

const CONTINUOUS = process.argv.includes('--continuous');
const FORCE_BACKFILL = process.argv.includes('--backfill');
const PERIOD_SEC = Math.max(10, Number(process.env.PROBE_PERIOD_SECONDS ?? 60));
const DB_URL = process.env.PROBE_DATABASE_URL ?? process.env.DATABASE_URL;
const RATE_LIMIT_RPS = Number(process.env.PROBE_RATE_LIMIT_RPS ?? 12);

const ACROSS_API_KEY = process.env.ACROSS_API_KEY ?? '';
const ACROSS_INTEGRATOR_ID = process.env.ACROSS_INTEGRATOR_ID ?? '';
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
    { key: 'aerodrome',    type: 'algebra',  addr: '0x254cf9e1e6e233aa1ac962cb9b05b2cfeaae15b0', label: 'Aerodrome' },
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
function tryAcquire(chainId) {
  const b = buckets[chainId];
  const now = Date.now();
  b.tokens = Math.min(RATE_LIMIT_RPS, b.tokens + ((now - b.last) / 1000) * RATE_LIMIT_RPS);
  b.last = now;
  if (b.tokens >= 1) { b.tokens -= 1; return true; }
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
// ABIs + ERC20 metadata cache (per chain: addr → { decimals, symbol })
// ============================================================================
const ERC20_ABI = ['function decimals() view returns (uint8)', 'function symbol() view returns (string)'];
const V2_ABI = ['function getAmountsOut(uint256 amountIn, address[] path) view returns (uint256[] amounts)'];
const V3_QUOTER_ABI = ['function quoteExactInputSingle((address tokenIn,address tokenOut,uint256 amountIn,uint24 fee,uint160 sqrtPriceLimitX96)) external returns (uint256 amountOut,uint160 sqrtPriceX96After,uint32 initializedTicksCrossed,uint256 gasCost)'];
const ALGEBRA_QUOTER_ABI = ['function quoteExactInputSingle(address tokenIn, address tokenOut, uint256 amountIn, uint160 limitSqrtPrice) external returns (uint256 amountOut)'];
// Velodrome Slipstream quoter — UniV3-QuoterV2-style tuple, but tickSpacing
// instead of fee. Verified on-chain 2026-08-15 (0.001 WETH → 1.879 USDC on
// both live quoters; flat and fee-tuple variants revert).
const SLIPSTREAM_QUOTER_ABI = ['function quoteExactInputSingle((address tokenIn, address tokenOut, uint256 amountIn, int24 tickSpacing, uint160 sqrtPriceLimitX96)) external returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)'];

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
    ?? await quoteSlipstreamAnyTs(chainId, addr, wethAddr, one);
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
  const v = VENUE_INFRA[chainId]?.find((x) => x.key === 'velodrome-slipstream');
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

// Fallback for long-tail tokens whose only OP pool is a Slipstream pool:
// try common tick spacings (a wrong ts simply reverts → null).
async function quoteSlipstreamAnyTs(chainId, tokenIn, tokenOut, amountIn) {
  for (const ts of [100, 50, 200, 10]) {
    const out = await quoteSlipstream(chainId, tokenIn, tokenOut, amountIn, ts);
    if (out && out > 0n) return out;
  }
  return null;
}

async function quoteVenue(chainId, venueKey, tokenIn, tokenOut, amountIn, fee) {
  if (venueKey === 'uniswap-v3') return quoteV3(chainId, tokenIn, tokenOut, amountIn, fee);
  if (venueKey === 'sushiswap-v2' || venueKey === 'velodrome-v2') return quoteV2(chainId, tokenIn, tokenOut, amountIn);
  // fee = tickSpacing for slipstream rows (registry fee_millionths quirk)
  if (venueKey === 'velodrome-slipstream') return quoteSlipstream(chainId, tokenIn, tokenOut, amountIn, fee);
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

async function refreshLiquidityForChain(chainId, runId) {
  const r = await db.query(
    `SELECT pool_addr, dex, pool_type, token0_addr, token1_addr, fee_millionths
       FROM dry_run_pool_registry WHERE chain_id = $1
       ORDER BY discovered_at DESC LIMIT 500`,
    [chainId],
  );
  let nEligible = 0;
  let nScanned = 0;
  const t0 = Date.now();
  for (const row of r.rows) {
    nScanned += 1;
    const poolT0 = Date.now();
    if (nScanned % 50 === 0) {
      console.log(`[liquidity ${chainId}] progress ${nScanned}/${r.rows.length} eligible=${nEligible} (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
    }
    try {
      // v2 → getReserves; v3 → slot0; algebra → globalState (different tuple shape)
      const metaDec = async (a) => (await getErc20Meta(chainId, a)).decimals;
      const priceUsd = async (a) => getPriceUsd(chainId, a);
      const tvlResult = row.pool_type === 'v2' || row.pool_type === 'solidly-v2'
        ? await readPoolTvlV2(providers[chainId], row.pool_addr, metaDec, priceUsd)
        : row.pool_type === 'algebra'
        ? await readPoolTvlAlgebra(providers[chainId], row.pool_addr, metaDec, priceUsd)
        : row.pool_type === 'slipstream'
        ? await readPoolTvlSlipstream(providers[chainId], row.pool_addr, metaDec, priceUsd)
        : await readPoolTvlV3(providers[chainId], row.pool_addr, metaDec, priceUsd);
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
      const poolMs = Date.now() - poolT0;
      if (poolMs > 3000) console.log(`[liquidity ${chainId}] SLOW pool ${row.pool_addr.slice(0, 12)} ${poolMs}ms (dex=${row.dex})`);
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
  console.log(`[liquidity ${chainId}] scanned=${nScanned} eligible=${nEligible} (range $${FILTER.tvlMinUsd}-$${FILTER.tvlMaxUsd})`);
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
      for (const usd of config.notionalsUsd) {
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
  const canonIndex = buildCanonicalIndex();
  // Universe: tokens in ANY pool position (token0 OR token1 — a token that is
  // always token1 was previously invisible) whose LATEST liquidity snapshot is
  // eligible — the same live TVL band as Phase 1, instead of whatever the
  // seeder happened to insert.
  const r = await db.query(
    `WITH latest_snap AS (
         SELECT DISTINCT ON (chain_id, pool_addr) chain_id, pool_addr, eligible
           FROM dry_run_liquidity_snapshots
          ORDER BY chain_id, pool_addr, observed_at DESC
       ),
       elig_pools AS (
         SELECT p.chain_id, p.token0_addr, p.token0_symbol, p.token1_addr, p.token1_symbol
           FROM dry_run_pool_registry p
           JOIN latest_snap s ON s.chain_id = p.chain_id AND s.pool_addr = p.pool_addr
          WHERE s.eligible = TRUE
       ),
       tokens AS (
         SELECT chain_id, token0_addr AS addr, token0_symbol AS symbol
           FROM elig_pools WHERE token0_symbol IS NOT NULL
         UNION
         SELECT chain_id, token1_addr AS addr, token1_symbol AS symbol
           FROM elig_pools WHERE token1_symbol IS NOT NULL
       )
       SELECT DISTINCT ON (chain_id, addr) chain_id, addr, symbol FROM tokens`,
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
    g.chains[chainId] = { addr: row.addr, priceUsd: p, symbol: row.symbol };
  }
  for (const [gk, g] of Object.entries(groups)) {
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
        // price_diff_bps / net_edge_bps are NUMERIC(10,4) — gaps ≥ 999999 bps
        // (9999%) mean one of the two quotes is broken; skip the pair.
        if (!Number.isFinite(priceDiffBps) || Math.abs(priceDiffBps) >= 999999) continue;
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
        for (const usd of config.notionalsUsd) {
          const amountInRaw = ethers.parseUnits((usd / buy.priceUsd).toFixed(Math.min(meta.decimals, 8)), meta.decimals);
          let bridgeFeeUsd = null, bridgeFeeBps = null, finalitySeconds = null, bridgeMeta = null;
          if (ACROSS_API_KEY && ACROSS_INTEGRATOR_ID) {
            const across = await fetchAcrossFee(buyChain, sellChain, buy.addr, sell.addr, amountInRaw);
            if (across && across.feePct != null) {
              bridgeFeeBps = across.feePct * 100;
              bridgeFeeUsd = (usd * across.feePct) / 100;
              finalitySeconds = across.finalitySeconds;
              bridgeMeta = { acrossRaw: across.raw };
            }
          }
          const netEdgeBps = bridgeFeeBps != null ? priceDiffBps - bridgeFeeBps : priceDiffBps;
          try {
            await db.query(
              `INSERT INTO dry_run_cross_chain_observations
                 (run_id, token, token_addr_buy_chain, token_addr_sell_chain,
                  buy_chain_id, sell_chain_id, notional_usd,
                  price_buy_usd, price_sell_usd, price_diff_bps,
                  bridge_protocol, bridge_fee_usd, bridge_fee_bps,
                  bridge_finality_seconds, net_edge_bps, metadata)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
              [
                runId, buy.symbol, buy.addr, sell.addr, buyChain, sellChain, usd,
                buy.priceUsd, sell.priceUsd, Number(priceDiffBps.toFixed(4)),
                ACROSS_API_KEY ? 'across' : 'none',
                bridgeFeeUsd != null ? Number(bridgeFeeUsd.toFixed(6)) : null,
                bridgeFeeBps != null ? Number(bridgeFeeBps.toFixed(4)) : null,
                finalitySeconds, Number(netEdgeBps.toFixed(4)),
                JSON.stringify({ trust, ...trustMeta, ...(bridgeMeta ?? { note: 'ACROSS_API_KEY not set' }) }),
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
  return nObs;
}

async function fetchAcrossFee(buyChainId, sellChainId, tokenAddrBuy, tokenAddrSell, amountInRaw) {
  const url = new URL(`${ACROSS_API_BASE}/suggested-fees`);
  url.searchParams.set('inputToken', tokenAddrBuy);
  url.searchParams.set('outputToken', tokenAddrSell);
  url.searchParams.set('inputChainId', String(buyChainId));
  url.searchParams.set('outputChainId', String(sellChainId));
  url.searchParams.set('inputAmount', amountInRaw.toString());
  url.searchParams.set('recipient', '0x0000000000000000000000000000000000000001');
  url.searchParams.set('integratorId', ACROSS_INTEGRATOR_ID);
  try {
    const r = await fetch(url, { headers: { Authorization: `Bearer ${ACROSS_API_KEY}` } });
    if (!r.ok) return null;
    const j = await r.json();
    const feePct = j.relayFeePct ?? j.totalFeePct ?? j.lpFeePct ?? null;
    return {
      feePct: feePct != null ? Number(feePct) : null,
      finalitySeconds: j.fillDeadlineSeconds ? Number(j.fillDeadlineSeconds) : null,
      raw: j,
    };
  } catch { return null; }
}

// ============================================================================
// Main loop
// ============================================================================
async function runOnce() {
  const runId = randomUUID();
  const t0 = Date.now();
  cycleCounter += 1;
  console.log(`[${new Date().toISOString()}] run ${runId} starting (cycle ${cycleCounter})`);
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
  const dur = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`[${new Date().toISOString()}] run ${runId} done — dex=${dexN} cross-chain=${ccN} in ${dur}s`);
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
  console.log(`# Period: ${PERIOD_SEC}s  Rate limit: ${RATE_LIMIT_RPS} rps/chain`);
  console.log(`# Backfill blocks: ${DISCOVERY.backfillBlocks}  Refresh every: ${DISCOVERY.refreshIntervalCycles} cycles`);
  console.log(`# Across API: ${ACROSS_API_KEY ? 'enabled' : 'disabled'}  Mode: ${CONTINUOUS ? 'continuous' : 'single cycle'}`);
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
