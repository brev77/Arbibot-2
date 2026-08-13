#!/usr/bin/env node
/**
 * Read-only Arbitrum cross-venue opportunity probe (extended).
 *
 * Round 2 (2026-08-12): adds long-tail Arbitrum-native tokens, stable pairs,
 * and Balancer V2 (wstETH/WETH stable pool — the only meaningful Balancer pool
 * on Arbitrum, TVL ~$4.6M is ~all LSTs).
 *
 * Venues:
 *   - SushiSwap V2 (0.30%)
 *   - Uniswap V3 (0.05% + 0.30%)
 *   - Camelot V3 (Algebra Integral, dynamic fees) — measured first time 2026-08-12
 *   - Balancer V2 (only where pools exist; here wstETH/WETH)
 *
 * Methodology: REALIZED round-trip quotes (NOT mid-price). For every ordered
 * venue pair (X buy, Y sell) computes round-trip bps. > 0 = gross-profitable.
 * Methodology matches apps/execution-orchestrator/src/execution/venue-quote.service.ts.
 *
 * Usage:
 *   RPC_ARBITRUM_MAINNET_URL=https://... node tools/probe-arb-opportunities.mjs
 *   node tools/probe-arb-opportunities.mjs   # public RPC fallback
 */

import { ethers } from 'ethers';

const RPC_URL = process.env.RPC_ARBITRUM_MAINNET_URL || 'https://arb1.arbitrum.io/rpc';
const provider = new ethers.JsonRpcProvider(RPC_URL, 42161, { staticNetwork: true });
const A = (x) => ethers.getAddress(x);

// === Tokens (Arbitrum One) ===
const T = {
  WETH:   { a: A('0x82af49447d8a07e3bd95bd0d56f35241523fbab1'), d: 18 },
  USDC:   { a: A('0xaf88d065e77c8cc2239327c5edb3a432268e5831'), d: 6  },
  USDCe:  { a: A('0xff970a61a04b1ca14834a43f5de4533ebdd5ccb8'), d: 6  },
  USDT:   { a: A('0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9'), d: 6  },
  ARB:    { a: A('0x912ce59144191c1204e64559fe8253a0e49e6548'), d: 18 },
  MAGIC:  { a: A('0x539bde0d7dbd336b79148aa722883795b2b9310b'), d: 18 },
  GMX:    { a: A('0xfc5a1a6eb076a2c7ad06ed22c90d7e710e35ad0a'), d: 18 },
  CRV:    { a: A('0x11cdb42b0eb46d95f990bedd4695a6e3fa034978'), d: 18 },
  LDO:    { a: A('0x13ad51ed4f1b7e9dc168d8a00cb3f4ddd85efa60'), d: 18 },
  WBTC:   { a: A('0x2f2a2543b76a4166549f7aab2e75bef0aefc5b0f'), d: 8  },
  wstETH: { a: A('0x5979d7b546e38e414f7e98215c9926a0c3fcdf4f'), d: 18 },
  RDNT:   { a: A('0x3082cc23568ea640225c2467183e85acb33af2df'), d: 18 },
  GRAIL:  { a: A('0x3d9907f9a368ad0a51be60f7da3b97cf940982d8'), d: 18 },
};

// === Venue contracts ===
const SUSHI_ROUTER   = A('0x1b02da8cb0d097eb8d57a175b88c7d8b47997506');
const UNIV3_QUOTER   = A('0x61ffe014ba17989e743c5f6cb21bf9697530b21e');
const CAMELOT_QUOTER = A('0x0fc73040b26e9bc8514fa028d998e73a254fa76e');
const BAL_VAULT      = A('0xba12222222228d8ba445958a75a0704d566bf2c8');
// Only confirmed-liquid Balancer pool on Arbitrum: wstETH/WETH stable pool
const BAL_WSTETH_WETH_POOL = '0x36bf227d6bac96e2ab1ebb5492ecec69c691943f000200000000000000000316';

// === ABIs ===
const V2_ABI = [
  'function getAmountsOut(uint256 amountIn, address[] path) view returns (uint256[] amounts)',
];
const V3_QUOTER_ABI = [
  'function quoteExactInputSingle((address tokenIn,address tokenOut,uint256 amountIn,uint24 fee,uint160 sqrtPriceLimitX96)) external returns (uint256 amountOut,uint160 sqrtPriceX96After,uint32 initializedTicksCrossed,uint256 gasCost)',
];
// Camelot (Algebra Integral v1.9) uses FLAT-arg, single-return ABI (verified 2026-08-12).
const ALGEBRA_QUOTER_ABI = [
  'function quoteExactInputSingle(address tokenIn, address tokenOut, uint256 amountIn, uint160 limitSqrtPrice) external returns (uint256 amountOut)',
];
const BAL_VAULT_ABI = [
  'function getPoolTokens(bytes32 poolId) view returns (address[] tokens, uint256[] balances, uint256 lastChangeBlock)',
  'function queryBatchSwap(uint8 kind, (bytes32 poolId, uint256 assetInIndex, uint256 assetOutIndex, uint256 amount, bytes userData)[] swaps, address[] assets, int256[] limits) external returns (int256[] assetDeltas)',
];

// === Quote primitives ===
async function quoteV2(tokenIn, tokenOut, amountIn) {
  try {
    const r = new ethers.Contract(SUSHI_ROUTER, V2_ABI, provider);
    const out = await r.getAmountsOut(amountIn, [tokenIn, tokenOut]);
    return out[1];
  } catch { return null; }
}

async function quoteV3(tokenIn, tokenOut, amountIn, fee) {
  try {
    const q = new ethers.Contract(UNIV3_QUOTER, V3_QUOTER_ABI, provider);
    const res = await q.quoteExactInputSingle.staticCall({
      tokenIn, tokenOut, amountIn, fee, sqrtPriceLimitX96: 0n,
    });
    return res[0];
  } catch { return null; }
}

async function quoteAlgebra(tokenIn, tokenOut, amountIn) {
  try {
    const q = new ethers.Contract(CAMELOT_QUOTER, ALGEBRA_QUOTER_ABI, provider);
    return await q.quoteExactInputSingle.staticCall(tokenIn, tokenOut, amountIn, 0n);
  } catch { return null; }
}

// Balancer V2 queryBatchSwap. Only valid for the configured pool (wstETH/WETH here).
let balPoolTokens = null;
async function quoteBalancer(poolId, tokenIn, tokenOut, amountIn) {
  try {
    const v = new ethers.Contract(BAL_VAULT, BAL_VAULT_ABI, provider);
    if (!balPoolTokens) {
      const r = await v.getPoolTokens.staticCall(poolId);
      balPoolTokens = r.tokens;
    }
    const inIndex = balPoolTokens.findIndex((t) => t.toLowerCase() === tokenIn.toLowerCase());
    const outIndex = balPoolTokens.findIndex((t) => t.toLowerCase() === tokenOut.toLowerCase());
    if (inIndex < 0 || outIndex < 0) return null;
    const swaps = [{ poolId, assetInIndex: inIndex, assetOutIndex: outIndex, amount: amountIn, userData: '0x' }];
    // limits: positive bounds on amounts; for query, signed max works
    const limits = balPoolTokens.map((_, i) => (i === inIndex ? amountIn : 0n));
    const deltas = await v.queryBatchSwap.staticCall(0, swaps, balPoolTokens, limits);
    return deltas[outIndex] > 0n ? deltas[outIndex] : null;
  } catch { return null; }
}

const VENUES = [
  { key: 'sushi',   fee: 0,    label: 'SushiV2'     },
  { key: 'uni-005', fee: 500,  label: 'UniV3 0.05%' },
  { key: 'uni-030', fee: 3000, label: 'UniV3 0.30%' },
  { key: 'camelot', fee: 0,    label: 'Camelot'     },
  { key: 'balancer', fee: 0,   label: 'Balancer'    }, // only meaningful for wstETH/WETH
];

async function quote(venue, tokenIn, tokenOut, amountIn) {
  if (venue.key === 'sushi')   return quoteV2(tokenIn, tokenOut, amountIn);
  if (venue.key === 'camelot') return quoteAlgebra(tokenIn, tokenOut, amountIn);
  if (venue.key === 'balancer') return quoteBalancer(BAL_WSTETH_WETH_POOL, tokenIn, tokenOut, amountIn);
  return quoteV3(tokenIn, tokenOut, amountIn, venue.fee);
}

const NOTIONALS_USD = [10, 100, 1000];
const PAIRS = [
  ['WETH', 'USDC'],   // baseline (most liquid)
  ['WETH', 'USDT'],
  ['ARB', 'WETH'],
  ['MAGIC', 'WETH'],  // Arbitrum-native gaming token
  ['GMX', 'WETH'],
  ['CRV', 'WETH'],
  ['LDO', 'WETH'],
  ['WBTC', 'WETH'],
  ['RDNT', 'WETH'],   // Arbitrum-native
  ['GRAIL', 'WETH'],  // Camelot's own token
  ['USDC', 'USDT'],   // stable pair
  ['USDC', 'USDCe'],  // stable migration pair
  ['wstETH', 'WETH'], // LST pair (only place Balancer matters)
];

// Robust multi-venue USD price: try UniV3 0.05% → Camelot → Sushi for each hop.
async function tryQuoteHops(tokenIn, tokenOut, amountIn) {
  for (const fn of [
    () => quoteV3(tokenIn, tokenOut, amountIn, 500),
    () => quoteAlgebra(tokenIn, tokenOut, amountIn),
    () => quoteV2(tokenIn, tokenOut, amountIn),
  ]) {
    const out = await fn();
    if (out && out > 0n) return out;
  }
  return null;
}

async function getUsdPrice(tokenKey) {
  if (['USDC', 'USDCe', 'USDT'].includes(tokenKey)) return 1;
  const tk = T[tokenKey];
  const one = 10n ** BigInt(tk.d);
  if (tokenKey === 'WETH') {
    const out = await tryQuoteHops(tk.a, T.USDC.a, one);
    return out ? Number(ethers.formatUnits(out, 6)) : null;
  }
  // For LST/staked tokens, treat as ~ETH-equivalent (price WETH * ratio).
  // First token→WETH→USDC.
  const wethOut = await tryQuoteHops(tk.a, T.WETH.a, one);
  if (!wethOut) return null;
  const usdcOut = await tryQuoteHops(T.WETH.a, T.USDC.a, wethOut);
  return usdcOut ? Number(ethers.formatUnits(usdcOut, 6)) : null;
}

const redactRpc = (u) => u.replace(/(v[0-9]\/)[A-Za-z0-9_-]+/, '$1<KEY>');

async function main() {
  console.log(`# Arbitrum cross-venue opportunity probe (extended — long-tail + Balancer)`);
  console.log(`# RPC: ${redactRpc(RPC_URL)}`);
  console.log(`# Date: ${new Date().toISOString()}`);
  console.log(`# REALIZED round-trip quotes (NOT mid-price). Positive bps = gross-profitable.`);
  console.log();

  // Venue sanity
  console.log('## Venue sanity (WETH→USDC, 0.001 WETH):');
  for (const v of VENUES.filter((x) => x.key !== 'balancer')) {
    const out = await quote(v, T.WETH.a, T.USDC.a, 10n ** 15n);
    console.log(`  ${v.label.padEnd(15)} ${out ? ethers.formatUnits(out, 6) + ' USDC' : 'NO QUOTE'}`);
  }
  // Balancer sanity (wstETH→WETH)
  const wstethOut = await quoteBalancer(BAL_WSTETH_WETH_POOL, T.wstETH.a, T.WETH.a, 10n ** 15n);
  console.log(`  Balancer(wstETH→WETH) ${wstethOut ? ethers.formatUnits(wstethOut, 18) + ' WETH' : 'NO QUOTE'}`);
  console.log();

  // USD prices
  console.log('## Token USD prices (multi-venue fallback):');
  const prices = {};
  for (const k of Object.keys(T)) {
    try {
      prices[k] = await getUsdPrice(k);
      console.log(`  ${k.padEnd(8)} $${prices[k]?.toFixed(4) ?? 'null'}`);
    } catch (e) {
      console.log(`  ${k.padEnd(8)} FAILED: ${e.message.slice(0, 80)}`);
    }
  }
  console.log();

  // Per-pair round-trips
  const allResults = [];
  for (const [A$, B$] of PAIRS) {
    if (prices[A$] == null) { console.log(`## ${A$}/${B$} — skipped (no USD price for ${A$})\n`); continue; }
    console.log(`## ${A$}/${B$}`);
    for (const usd of NOTIONALS_USD) {
      const amountInA = ethers.parseUnits((usd / prices[A$]).toFixed(Math.min(T[A$].d, 6)), T[A$].d);
      // fwd[V]: A→B quote per venue (parallel)
      const fwd = {};
      await Promise.all(VENUES.map(async (v) => { fwd[v.key] = await quote(v, T[A$].a, T[B$].a, amountInA); }));
      // For each venue-pair, sell fwd[X] B back via Y for A
      const trips = [];
      for (const vx of VENUES) {
        if (!fwd[vx.key] || fwd[vx.key] === 0n) continue;
        const bAmt = fwd[vx.key];
        const revPerY = {};
        await Promise.all(VENUES.map(async (vy) => {
          if (vy.key === vx.key) return;
          revPerY[vy.key] = await quote(vy, T[B$].a, T[A$].a, bAmt);
        }));
        for (const vy of VENUES) {
          if (vy.key === vx.key) continue;
          const back = revPerY[vy.key];
          if (!back) continue;
          const bps = Number((back - amountInA) * 10000n / amountInA);
          trips.push({ buy: vx.label, sell: vy.label, bps });
        }
      }
      trips.sort((x, y) => y.bps - x.bps);
      const top = trips[0];
      const flag = top && top.bps > 0 ? ' 🟢' : '';
      console.log(`  $${String(usd).padStart(5)}: top=${top ? top.bps : 'n/a'} bps [${top ? `${top.buy}→${top.sell}` : '-'}]${flag}`);
      const fwdStr = VENUES.map((v) => `${v.label}=${fwd[v.key] ? ethers.formatUnits(fwd[v.key], T[B$].d) : '-'}`).join('  ');
      console.log(`         A→B: ${fwdStr}`);
      allResults.push({ pair: `${A$}/${B$}`, usd, top, trips });
    }
    console.log();
  }

  // Summary
  console.log('## Summary — gross-profitable round-trips (>0 bps, net of pool fees, gross of gas):');
  let anyProfit = false;
  for (const r of allResults) {
    const pos = r.trips.filter((t) => t.bps > 0);
    if (pos.length === 0) continue;
    anyProfit = true;
    console.log(`  ${r.pair.padEnd(13)} $${String(r.usd).padStart(5)}: ` +
      pos.slice(0, 3).map((t) => `${t.buy}→${t.sell}=${t.bps}bps`).join(', '));
  }
  if (!anyProfit) console.log('  NONE — all measured round-trips are net negative after pool fees.');
  console.log();
  console.log('## Closest-to-zero (most interesting, even if negative):');
  const closest = allResults
    .map((r) => ({ pair: r.pair, usd: r.usd, top: r.top }))
    .filter((x) => x.top)
    .sort((a, b) => b.top.bps - a.top.bps)
    .slice(0, 8);
  for (const c of closest) {
    console.log(`  ${c.pair.padEnd(13)} $${String(c.usd).padStart(5)}: ${c.top.bps} bps [${c.top.buy}→${c.top.sell}]`);
  }
}

main().catch((e) => { console.error('Probe failed:', e); process.exit(1); });
