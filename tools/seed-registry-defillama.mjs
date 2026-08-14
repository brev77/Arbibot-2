#!/usr/bin/env node
/**
 * Seed dry_run_pool_registry from DefiLlama + on-chain factory lookups.
 *
 * Why: BlockPi (paid plan) does not index factory PoolCreated events, so
 * event-based discovery finds nothing. DefiLlama's /pools API gives us the
 * token pairs + TVL + DEX name for free, but not the pool contract address
 * (its `pool` field is a DefiLlama UUID). This script combines both:
 *   1. DefiLlama  — which (chain, DEX, tokenA, tokenB, fee-tier, TVL) exist
 *   2. BlockPi    — factory.getPool / getPair / pool view calls to resolve
 *                   the actual pool contract address (eth_call works fine)
 *
 * Output: rows in dry_run_pool_registry. The probe's liquidity stage then
 * reads on-chain TVL and marks eligibility per the configured band.
 *
 * Usage (on the server, from repo root):
 *   node tools/seed-registry-defillama.mjs            # uses cached /tmp/llama_pools.json
 *   curl -sS https://yields.llama.fi/pools -o /tmp/llama_pools.json   # refresh cache first
 *
 * Env: PROBE_RPC_*_URL + PROBE_DATABASE_URL (or DATABASE_URL) from .env
 */

import { ethers } from 'ethers';
import { readFileSync } from 'node:fs';
import pg from 'pg';

const LLAMA_PATH = process.argv.includes('--refresh') ? null : '/tmp/llama_pools.json';
const TVL_MIN = Number(process.env.SEED_TVL_MIN ?? 10_000);
const TVL_MAX = Number(process.env.SEED_TVL_MAX ?? 500_000);

// target DEX projects per chain (DefiLlama project slugs)
// NOTE: DefiLlama names Optimism "OP Mainnet" — chainMap below reflects that.
const PROJECTS = {
  42161: {
    'camelot-v3': { type: 'algebra', dex: 'camelot' },
    'uniswap-v3': { type: 'v3', dex: 'uniswap-v3' },
    'sushiswap-v3': { type: 'v3', dex: 'uniswap-v3' },
    sushiswap: { type: 'v2', dex: 'sushiswap-v2' },
  },
  8453: {
    'uniswap-v3': { type: 'v3', dex: 'uniswap-v3' },
    'sushiswap-v3': { type: 'v3', dex: 'uniswap-v3' },
    sushiswap: { type: 'v2', dex: 'sushiswap-v2' },
    // aerodrome-slipstream: factory interface not yet confirmed (both getPool(a,b,ts)
    // and poolByPair revert) — TODO after Basescan V2 API check
  },
  10: {
    'uniswap-v3': { type: 'v3', dex: 'uniswap-v3' },
    'velodrome-v2': { type: 'solidly-v2', dex: 'velodrome-v2' },
    // velodrome-v3 (Slipstream): factory getPool(a,b,ts) works but quoter ABI
    // style unconfirmed (flat+tuple both fail) — TODO
  },
};

// factory contracts per (chain, pool_type) for address resolution
const FACTORIES = {
  42161: {
    algebra: '0x1a3c9B1d2F0529D97f2afC5136Cc23e58f1FD35B', // Camelot AlgebraFactory
    v3: '0x1F98431c8aD98523631AE4a59f267346ea31F984',      // UniV3 canonical
    v2: '0xc35DADB65012eC5796536bD9864eD8773aBc74C4',      // Sushi V2
  },
  8453: {
    // official Base deployment (developers.uniswap.org); NB: contracts-eth
    // has a typo in the tail (...d594dd274d2f3 = EOA)
    v3: '0x33128a8fC17869897dcE68Ed026d694621f6FDfD',
    v2: '0x7Dae51aE332A0E1F979b1B1d01ED6D68468e41ec',      // Sushi Base
  },
  10: {
    v3: '0x1F98431c8aD98523631AE4a59f267346ea31F984',      // UniV3 canonical (verified)
    'solidly-v2': '0xF1046053aa5682b4F9a81b5481394DA16BE5FF5a', // Velodrome V2 (getPair w/ stable flag)
  },
};

const V3_FACTORY_ABI = ['function getPool(address a, address b, uint24 fee) view returns (address pool)'];
const V2_FACTORY_ABI = ['function getPair(address a, address b) view returns (address pair)'];
const SOLIDLY_FACTORY_ABI = ['function getPair(address a, address b, bool stable) view returns (address pair)'];
const ALGEBRA_FACTORY_ABI = ['function poolByPair(address a, address b) view returns (address pool)'];

// fee tier string → millionths
function parseFeeTier(poolMeta) {
  if (!poolMeta) return null;
  const m = String(poolMeta).match(/([\d.]+)\s*%/);
  if (!m) return null;
  const pct = parseFloat(m[1]);
  if (Number.isNaN(pct)) return null;
  return Math.round(pct * 10000); // 0.05% → 500
}

async function main() {
  // ---- load env ----
  const dbUrl = process.env.PROBE_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!dbUrl) { console.error('PROBE_DATABASE_URL or DATABASE_URL required'); process.exit(1); }
  const db = new pg.Pool({ connectionString: dbUrl });

  // ---- providers ----
  const providers = {};
  const rpcNames = { 42161: 'PROBE_RPC_ARBITRUM_URL', 8453: 'PROBE_RPC_BASE_URL', 10: 'PROBE_RPC_OPTIMISM_URL' };
  for (const [cid, envName] of Object.entries(rpcNames)) {
    const url = process.env[envName];
    if (!url) { console.error(`Missing ${envName}`); process.exit(1); }
    providers[cid] = new ethers.JsonRpcProvider(url, Number(cid), { staticNetwork: true });
  }
  // snapshot latest block per chain — seeded pools get created_at_block = latest
  // so that the probe's incremental event sync starts from NOW instead of
  // backfilling from genesis (which would hang for hours)
  const latestBlocks = {};
  for (const cid of Object.keys(providers)) {
    try { latestBlocks[cid] = await providers[cid].getBlockNumber(); }
    catch { latestBlocks[cid] = null; }
  }
  console.log('latest blocks:', JSON.stringify(latestBlocks));

  // ---- load DefiLlama ----
  let pools;
  try {
    const raw = JSON.parse(readFileSync(LLAMA_PATH, 'utf8'));
    pools = raw.data ?? raw;
  } catch (e) {
    console.error(`Failed to read ${LLAMA_PATH}: ${e.message}. Run: curl -sS https://yields.llama.fi/pools -o /tmp/llama_pools.json`);
    process.exit(1);
  }

  // ---- filter ----
  const wanted = [];
  for (const p of pools) {
    const chainMap = { Arbitrum: 42161, Base: 8453, 'OP Mainnet': 10 };
    const chainId = chainMap[p.chain];
    if (!chainId) continue;
    const projCfg = PROJECTS[chainId]?.[p.project];
    if (!projCfg) continue;
    const tvl = p.tvlUsd ?? 0;
    if (tvl < TVL_MIN || tvl > TVL_MAX) continue;
    const toks = p.underlyingTokens;
    if (!Array.isArray(toks) || toks.length !== 2) continue;
    wanted.push({
      chainId, tvl,
      type: projCfg.type, dex: projCfg.dex,
      tokenA: ethers.getAddress(toks[0]),
      tokenB: ethers.getAddress(toks[1]),
      symbols: String(p.symbol ?? ''),
      fee: projCfg.type === 'v3' ? parseFeeTier(p.poolMeta) : null,
    });
  }
  console.log(`DefiLlama candidates in $${TVL_MIN}-$${TVL_MAX} TVL: ${wanted.length}`);
  const byChain = {};
  for (const w of wanted) byChain[w.chainId] = (byChain[w.chainId] ?? 0) + 1;
  console.log('  by chain:', JSON.stringify(byChain));

  // ---- resolve pool addresses via factory view calls ----
  let inserted = 0, skipped = 0, noPool = 0;
  const seen = new Set();
  for (const w of wanted) {
    const provider = providers[w.chainId];
    const factoryAddr = FACTORIES[w.chainId]?.[w.type];
    if (!factoryAddr) { skipped++; continue; }
    const key = `${w.chainId}:${w.dex}:${w.tokenA}:${w.tokenB}:${w.fee ?? 'x'}`;
    if (seen.has(key)) continue;
    seen.add(key);

    let poolAddr = null;
    try {
      if (w.type === 'v2') {
        if (!w.fee) {
          const c = new ethers.Contract(factoryAddr, V2_FACTORY_ABI, provider);
          const r = await c.getPair.staticCall(w.tokenA, w.tokenB);
          if (r && r !== ethers.ZeroAddress) poolAddr = r;
        }
      } else if (w.type === 'v3') {
        if (w.fee != null) {
          const c = new ethers.Contract(factoryAddr, V3_FACTORY_ABI, provider);
          const r = await c.getPool.staticCall(w.tokenA, w.tokenB, w.fee);
          if (r && r !== ethers.ZeroAddress) poolAddr = r;
        }
      } else if (w.type === 'algebra') {
        const c = new ethers.Contract(factoryAddr, ALGEBRA_FACTORY_ABI, provider);
        const r = await c.poolByPair.staticCall(w.tokenA, w.tokenB);
        if (r && r !== ethers.ZeroAddress) poolAddr = r;
      } else if (w.type === 'solidly-v2') {
        // Solidly-style factory (Velodrome V2): getPair(a, b, stable) — probe both variants
        const c = new ethers.Contract(factoryAddr, SOLIDLY_FACTORY_ABI, provider);
        for (const stable of [true, false]) {
          const r = await c.getPair.staticCall(w.tokenA, w.tokenB, stable);
          if (r && r !== ethers.ZeroAddress) { poolAddr = r; break; }
        }
      }
    } catch { /* factory call failed — skip */ }
    if (!poolAddr) { noPool++; continue; }

    const [s0, s1] = w.symbols.split('-');
    try {
      await db.query(
        `INSERT INTO dry_run_pool_registry
           (chain_id, pool_addr, dex, pool_type, token0_addr, token1_addr, fee_millionths,
            token0_symbol, token1_symbol, created_at_block)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         ON CONFLICT (chain_id, pool_addr) DO NOTHING`,
        [w.chainId, poolAddr.toLowerCase(), w.dex, w.type,
         w.tokenA.toLowerCase(), w.tokenB.toLowerCase(),
         w.fee, s0 ?? null, s1 ?? null,
         latestBlocks[w.chainId] ?? null],
      );
      inserted++;
    } catch (e) {
      console.error(`insert ${key}: ${e.message.slice(0, 100)}`);
    }
    // light pacing to be polite to RPC
    await new Promise((r) => setTimeout(r, 60));
  }
  console.log(`Done: inserted=${inserted} skipped=${skipped} factory-returned-nothing=${noPool}`);

  const summary = await db.query(
    'SELECT chain_id, dex, COUNT(*) AS n FROM dry_run_pool_registry GROUP BY 1,2 ORDER BY 1,2',
  );
  console.table(summary.rows);
  await db.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
