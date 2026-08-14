/**
 * Autonomous pool discovery + liquidity filtering for the dry-run probe.
 *
 * Two discovery mechanisms:
 *   1. Factory event sync (V3 PoolCreated + V2 PairCreated) for Uniswap V3 and
 *      SushiSwap V2 factories — well-known event signatures, full enumeration.
 *   2. Algebra probing (Camelot / Aerodrome Slipstream / Velodrome Slipstream):
 *      their factories emit non-standard events, so we probe known token pairs
 *      via factory.getPool. Seed list = tokens discovered via mechanism 1.
 *
 * Liquidity reads:
 *   - V2 TVL: getReserves → reserve0 × price0 + reserve1 × price1 (USD).
 *   - V3 TVL: virtual reserves from liquidity + slot0.sqrtPriceX96.
 *     (Approximation — true in-range TVL needs tick bitmap walk; virtual
 *     reserves are the marginal-liquidity proxy used by most analytics. Good
 *     enough for a $10K–$500K band filter.)
 *   - 24h volume: eth_getLogs for Swap events over last 24h of blocks,
 *     summed in USD. Paged to respect RPC range limits.
 *
 * All writes go to dry_run_pool_registry (append-mostly) and
 * dry_run_liquidity_snapshots (time series).
 */

import { ethers } from 'ethers';

// ============================================================================
// Event signatures (keccak256 topic hashes)
// ============================================================================
const POOL_CREATED_V3_TOPIC = '0x783cca1c0412dd0d695e294139682e5419462856bdfc5f3bb5f3f24b7e9deb7e';
// Uniswap V3: PoolCreated(address indexed token0, address indexed token1, uint24 indexed fee, int24 tickSpacing, address pool)

const PAIR_CREATED_V2_TOPIC = '0x0d3648bd0f9ba286a679301e019dfee077688e5eaa0f08375187b93f2e8dc7fb';
// Uniswap V2: PairCreated(address indexed token0, address indexed token1, address pair, uint256)

const SWAP_V3_TOPIC = '0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64d8004d293d18c7f9fe';
// V3 Swap(sender,recipient,int256 amount0,int256 amount1,uint160 sqrtPriceX96,uint128 liquidity,int24 tick)

const SWAP_V2_TOPIC = '0xd78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d822';
// V2 Swap(address sender,uint amount0In,uint amount1In,uint amount0Out,uint amount1Out,address to)

// ============================================================================
// Factory configs (V3 + V2 only; Algebra DEXes are probed separately)
// ============================================================================
export const FACTORIES = {
  42161: [
    { addr: '0x1F98431c8aD98523631AE4a59f267346ea31F984', type: 'v3', dex: 'uniswap-v3' },
    { addr: '0xc35DADB65012eC5796536bD9864eD8773aBc74C4', type: 'v2', dex: 'sushiswap-v2' },
  ],
  8453: [
    { addr: '0x33128a8fC17869897dcE68Ed026d594dd274D2f3', type: 'v3', dex: 'uniswap-v3' },
    { addr: '0x7Dae51aE332A0E1F979b1B1d01ED6D68468e41ec', type: 'v2', dex: 'sushiswap-v2' },
  ],
  10: [
    { addr: '0x1F98431c8aD98523631AE4a59f267346ea31F984', type: 'v3', dex: 'uniswap-v3' },
  ],
};

// Algebra DEXes — probed (factory.getPool-like) rather than event-synced.
// For Camelot/Aerodrome/Velodrome Slipstream we use the Algebra factory directly.
export const ALGEBRA_DEXES = {
  42161: [{ dex: 'camelot', factory: '0xAA3E8aBAa790E0D571d428c5a3D0234Bb8d1E652', type: 'algebra' }],
  8453:  [{ dex: 'aerodrome', factory: '0x330EeF8bB6F2E998E50a96c5aEd25eD3eb3e1EFF', type: 'algebra' }],
  10:    [{ dex: 'velodrome', factory: '0xF1046053aa5682b4F9a81b5481394DA16BE5FF5a', type: 'algebra' }],
};

// V3 fee tiers to probe (Algebra has dynamic fees, single pool per pair)
const V3_FEE_TIERS = [500, 3000, 10000];

// ============================================================================
// ABIs
// ============================================================================
const V3_FACTORY_ABI = [
  'function getPool(address tokenA, address tokenB, uint24 fee) view returns (address pool)',
];
const V2_FACTORY_ABI = [
  'function getPair(address tokenA, address tokenB) view returns (address pair)',
];
const ALGEBRA_FACTORY_ABI = [
  'function pool(address tokenA, address tokenB) view returns (address pool)',
];
const V3_POOL_ABI = [
  'function token0() view returns (address)',
  'function token1() view returns (address)',
  'function fee() view returns (uint24)',
  'function liquidity() view returns (uint128)',
  'function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16 obsIdx, uint16 obsCard, uint16 obsCardNext, uint8 feeProtocol, bool unlocked)',
];
const V2_POOL_ABI = [
  'function token0() view returns (address)',
  'function token1() view returns (address)',
  'function getReserves() view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)',
];
const ERC20_ABI = [
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
];

// ============================================================================
// Persistence helpers
// ============================================================================
export async function insertPool(db, chainId, poolAddr, dex, poolType, token0, token1, feeMillionths, createdAtBlock) {
  await db.query(
    `INSERT INTO dry_run_pool_registry
       (chain_id, pool_addr, dex, pool_type, token0_addr, token1_addr, fee_millionths, created_at_block)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (chain_id, pool_addr) DO NOTHING`,
    [chainId, poolAddr.toLowerCase(), dex, poolType,
     token0.toLowerCase(), token1.toLowerCase(),
     feeMillionths ?? null, createdAtBlock ?? null],
  );
}

export async function setTokenSymbol(db, chainId, tokenAddr, symbol) {
  if (!symbol) return;
  await db.query(
    `UPDATE dry_run_pool_registry SET token0_symbol = $3
       WHERE chain_id = $1 AND token0_addr = $2 AND token0_symbol IS NULL`,
    [chainId, tokenAddr.toLowerCase(), symbol],
  );
  await db.query(
    `UPDATE dry_run_pool_registry SET token1_symbol = $3
       WHERE chain_id = $1 AND token1_addr = $2 AND token1_symbol IS NULL`,
    [chainId, tokenAddr.toLowerCase(), symbol],
  );
}

export async function insertLiquiditySnapshot(db, row) {
  await db.query(
    `INSERT INTO dry_run_liquidity_snapshots
       (run_id, chain_id, pool_addr, dex, token0_addr, token1_addr,
        tvl_usd, volume_24h_usd, reserve0, reserve1, last_swap_at, eligible)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [
      row.runId, row.chainId, row.poolAddr.toLowerCase(),
      row.dex, row.token0.toLowerCase(), row.token1.toLowerCase(),
      row.tvlUsd ?? null, row.volume24hUsd ?? null,
      row.reserve0?.toString() ?? null, row.reserve1?.toString() ?? null,
      row.lastSwapAt ?? null, row.eligible ?? false,
    ],
  );
}

// ============================================================================
// V3 + V2 factory event sync (page through eth_getLogs)
// ============================================================================
export async function syncFactoryEvents(provider, db, chainId, fromBlock, toBlock, rateLimitFn) {
  const factories = FACTORIES[chainId] ?? [];
  let nAdded = 0;
  for (const factory of factories) {
    if (factory.type === 'v3') {
      nAdded += await syncV3Events(provider, db, chainId, factory, fromBlock, toBlock, rateLimitFn);
    } else if (factory.type === 'v2') {
      nAdded += await syncV2Events(provider, db, chainId, factory, fromBlock, toBlock, rateLimitFn);
    }
  }
  return nAdded;
}

async function syncV3Events(provider, db, chainId, factory, fromBlock, toBlock, rateLimitFn) {
  const iface = new ethers.Interface(['event PoolCreated(address indexed token0, address indexed token1, uint24 indexed fee, int24 tickSpacing, address pool)']);
  return pageThroughEvents(provider, db, chainId, factory, POOL_CREATED_V3_TOPIC, iface, 'v3', fromBlock, toBlock, rateLimitFn);
}

async function syncV2Events(provider, db, chainId, factory, fromBlock, toBlock, rateLimitFn) {
  const iface = new ethers.Interface(['event PairCreated(address indexed token0, address indexed token1, address pair, uint256)']);
  return pageThroughEvents(provider, db, chainId, factory, PAIR_CREATED_V2_TOPIC, iface, 'v2', fromBlock, toBlock, rateLimitFn);
}

async function pageThroughEvents(provider, db, chainId, factory, topic, iface, poolType, fromBlock, toBlock, rateLimitFn) {
  const PAGE = 5000; // conservative; some RPCs reject larger ranges
  let nAdded = 0;
  for (let from = fromBlock; from <= toBlock; from += PAGE) {
    const to = Math.min(from + PAGE - 1, toBlock);
    await rateLimitFn(chainId);
    try {
      const logs = await provider.getLogs({
        address: factory.addr,
        topics: [topic],
        fromBlock: from,
        toBlock: to,
      });
      for (const log of logs) {
        if (log.removed) continue;
        try {
          const parsed = iface.parseLog({ topics: log.topics, data: log.data });
          const token0 = ethers.getAddress(parsed.args.token0);
          const token1 = ethers.getAddress(parsed.args.token1);
          const poolAddr = ethers.getAddress(parsed.args.pool);
          const fee = poolType === 'v3' ? Number(parsed.args.fee) : null;
          await insertPool(db, chainId, poolAddr, factory.dex, poolType, token0, token1, fee, log.blockNumber);
          nAdded += 1;
        } catch { /* skip malformed */ }
      }
    } catch (e) {
      // RPC range too large or transient error — shrink page and retry once
      if (PAGE > 500) {
        const half = Math.floor((to - from) / 2) + from;
        nAdded += await pageThroughEvents(provider, db, chainId, factory, topic, iface, poolType, from, half, rateLimitFn);
        nAdded += await pageThroughEvents(provider, db, chainId, factory, topic, iface, poolType, half + 1, to, rateLimitFn);
        return nAdded;
      }
      // give up on this page
    }
  }
  return nAdded;
}

// ============================================================================
// Algebra probing — look up pools for known token pairs (from V3/V2 discovery)
// ============================================================================
export async function probeAlgebraPools(provider, db, chainId, rateLimitFn) {
  const dexes = ALGEBRA_DEXES[chainId] ?? [];
  if (dexes.length === 0) return 0;
  // Get unique token pairs from registry (limit to a reasonable sample)
  const r = await db.query(
    `SELECT DISTINCT token0_addr, token1_addr FROM dry_run_pool_registry
       WHERE chain_id = $1 AND dex IN ('uniswap-v3','sushiswap-v2')
       LIMIT 500`,
    [chainId],
  );
  let nAdded = 0;
  for (const dex of dexes) {
    const f = new ethers.Contract(dex.factory, ALGEBRA_FACTORY_ABI, provider);
    for (const { token0_addr, token1_addr } of r.rows) {
      await rateLimitFn(chainId);
      try {
        const poolAddr = await f.pool.staticCall(token0_addr, token1_addr);
        if (poolAddr && poolAddr !== '0x0000000000000000000000000000000000000000') {
          await insertPool(db, chainId, ethers.getAddress(poolAddr), dex.dex, 'algebra',
            ethers.getAddress(token0_addr), ethers.getAddress(token1_addr), null, null);
          nAdded += 1;
        }
      } catch { /* skip */ }
    }
  }
  return nAdded;
}

// ============================================================================
// Backfill (one-time) — sync from N blocks ago to latest
// ============================================================================
export async function backfillPools(provider, db, chainId, backfillBlocks, rateLimitFn) {
  const latest = await provider.getBlockNumber();
  const from = Math.max(0, latest - backfillBlocks);
  console.log(`[discovery ${chainId}] backfilling blocks ${from}..${latest} (~${latest - from} blocks)`);
  const n = await syncFactoryEvents(provider, db, chainId, from, latest, rateLimitFn);
  console.log(`[discovery ${chainId}] backfill done — ${n} new pools from events`);
  const nAlg = await probeAlgebraPools(provider, db, chainId, rateLimitFn);
  console.log(`[discovery ${chainId}] algebra probing done — ${nAlg} new pools`);
  return n + nAlg;
}

// ============================================================================
// Incremental sync — new events since lastBlock
// ============================================================================
export async function incrementalSync(provider, db, chainId, rateLimitFn) {
  const latest = await provider.getBlockNumber();
  // Determine last synced block from registry (max created_at_block)
  const r = await db.query(
    'SELECT COALESCE(MAX(created_at_block), 0) AS last FROM dry_run_pool_registry WHERE chain_id = $1',
    [chainId],
  );
  const fromBlock = Math.max(0, Number(r.rows[0].last) - 100); // small overlap for safety
  if (latest <= fromBlock) return 0;
  return syncFactoryEvents(provider, db, chainId, fromBlock, latest, rateLimitFn);
}

// ============================================================================
// Liquidity reads — TVL via virtual reserves + slot0
// ============================================================================
export async function readPoolMetadata(provider, poolAddr, poolType) {
  const abi = poolType === 'v3' ? V3_POOL_ABI : V2_POOL_ABI;
  const c = new ethers.Contract(poolAddr, abi, provider);
  const [token0, token1] = await Promise.all([c.token0.staticCall(), c.token1.staticCall()]);
  let fee = null;
  if (poolType === 'v3') {
    try { fee = Number(await c.fee.staticCall()); } catch { /* legacy V3 */ }
  }
  return { token0: ethers.getAddress(token0), token1: ethers.getAddress(token1), fee };
}

export async function readPoolTvl(provider, poolAddr, poolType, decimalsOf, priceOf) {
  const c = new ethers.Contract(poolAddr, poolType === 'v3' ? V3_POOL_ABI : V2_POOL_ABI, provider);
  if (poolType === 'v2') {
    const r = await c.getReserves.staticCall();
    const d0 = await decimalsOf(c.token0 ? await c.token0.staticCall() : null);
    // ^ above is wasteful; we expect caller to pass decimalsOf/priceOf keyed by addr
    return null;
  }
  // V3: liquidity + slot0.sqrtPriceX96 → virtual reserves
  const [liq, slot0] = await Promise.all([c.liquidity.staticCall(), c.slot0.staticCall()]);
  const sqrtPrice = (slot0.sqrtPriceX96 * slot0.sqrtPriceX96) / (1n << 192n); // = sqrtPriceX96² / 2¹⁹²
  // virtualReserve0 (raw token0 units) = liquidity / sqrtPrice
  // virtualReserve1 (raw token1 units) = liquidity * sqrtPrice
  // Using fixed-point: avoid floats, keep bigint for as long as possible.
  // virtualReserve1 = liquidity * sqrtPriceX96 / 2^96
  const vReserve1 = (liq * slot0.sqrtPriceX96) >> 96n;
  // virtualReserve0 = liquidity * 2^96 / sqrtPriceX96
  const vReserve0 = (liq << 96n) / slot0.sqrtPriceX96;
  return { reserve0: vReserve0, reserve1: vReserve1 };
}

/**
 * Read pool TVL with caller-supplied decimal + price lookups.
 * decimalsOf(addr) → number; priceOf(addr) → USD price per raw unit × 10^decimals
 */
export async function readPoolTvlV2(provider, poolAddr, decimalsOf, priceOf) {
  const c = new ethers.Contract(poolAddr, V2_POOL_ABI, provider);
  const [token0, token1, r] = await Promise.all([
    c.token0.staticCall(),
    c.token1.staticCall(),
    c.getReserves.staticCall(),
  ]);
  const d0 = await decimalsOf(token0);
  const d1 = await decimalsOf(token1);
  const p0 = await priceOf(token0);
  const p1 = await priceOf(token1);
  if (p0 == null || p1 == null) return null;
  const tvlUsd = (Number(r.reserve0) / 10 ** d0) * p0 + (Number(r.reserve1) / 10 ** d1) * p1;
  return { token0, token1, reserve0: r.reserve0, reserve1: r.reserve1, tvlUsd };
}

export async function readPoolTvlV3(provider, poolAddr, decimalsOf, priceOf) {
  const c = new ethers.Contract(poolAddr, V3_POOL_ABI, provider);
  const [token0, token1, liq, slot0] = await Promise.all([
    c.token0.staticCall(),
    c.token1.staticCall(),
    c.liquidity.staticCall(),
    c.slot0.staticCall(),
  ]);
  return tvlFromVirtualReserves(token0, token1, liq, slot0.sqrtPriceX96, decimalsOf, priceOf);
}

// Algebra Integral pools (Camelot / Aerodrome / Velodrome Slipstream) expose the
// sqrt price via globalState() — their slot0() tuple has a different shape and
// would fail ethers decoding.
const ALGEBRA_POOL_ABI = [
  'function token0() view returns (address)',
  'function token1() view returns (address)',
  'function liquidity() view returns (uint128)',
  'function globalState() view returns (uint160 price, int24 tick, uint16 feeZto, uint16 feeOtz, uint16 timepointIndex, uint8 communityFeeToken0, uint8 communityFeeToken1, bool unlocked)',
];

export async function readPoolTvlAlgebra(provider, poolAddr, decimalsOf, priceOf) {
  const c = new ethers.Contract(poolAddr, ALGEBRA_POOL_ABI, provider);
  const [token0, token1, liq, gs] = await Promise.all([
    c.token0.staticCall(),
    c.token1.staticCall(),
    c.liquidity.staticCall(),
    c.globalState.staticCall(),
  ]);
  return tvlFromVirtualReserves(token0, token1, liq, gs.price, decimalsOf, priceOf);
}

function tvlFromVirtualReserves(token0, token1, liq, sqrtPriceX96, decimalsOf, priceOf) {
  if (liq === 0n) return { token0, token1, reserve0: 0n, reserve1: 0n, tvlUsd: 0 };
  if (sqrtPriceX96 === 0n) return null;
  // Virtual reserves (marginal liquidity approximation)
  const vReserve1 = (liq * sqrtPriceX96) >> 96n;
  const vReserve0 = (liq << 96n) / sqrtPriceX96;
  return (async () => {
    const d0 = await decimalsOf(token0);
    const d1 = await decimalsOf(token1);
    const p0 = await priceOf(token0);
    const p1 = await priceOf(token1);
    if (p0 == null || p1 == null) return null;
    const tvlUsd = (Number(vReserve0) / 10 ** d0) * p0 + (Number(vReserve1) / 10 ** d1) * p1;
    return { token0, token1, reserve0: vReserve0, reserve1: vReserve1, tvlUsd };
  })();
}

// ============================================================================
// 24h volume via Swap events
// ============================================================================
export async function readPoolVolume24h(provider, chainId, poolAddr, poolType, decimalsOf, priceOf, rateLimitFn) {
  // Algebra pools emit the same Swap event shape as UniV3
  const topic = poolType === 'v2' ? SWAP_V2_TOPIC : SWAP_V3_TOPIC;
  // Approximate 24h block count. Arbitrum ~0.25s/block → ~345600; Base/Op ~2s → ~43200.
  const BLOCKS_PER_24H = chainId === 42161 ? 345600 : 43200;
  const latest = await provider.getBlockNumber();
  const fromBlock = Math.max(0, latest - BLOCKS_PER_24H);
  const PAGE = 10000;
  let volumeUsd = 0;
  let lastSwapAt = null;
  for (let from = fromBlock; from <= latest; from += PAGE) {
    const to = Math.min(from + PAGE - 1, latest);
    await rateLimitFn(chainId);
    try {
      const logs = await provider.getLogs({
        address: poolAddr,
        topics: [topic],
        fromBlock: from,
        toBlock: to,
      });
      if (logs.length === 0) continue;
      const c = new ethers.Contract(poolAddr, V3_POOL_ABI, provider); // for token0/1 — read once
      let token0 = null, token1 = null, d0 = null, d1 = null, p0 = null, p1 = null;
      for (const log of logs) {
        if (!token0) {
          token0 = await c.token0.staticCall();
          token1 = await c.token1.staticCall();
          d0 = await decimalsOf(token0);
          d1 = await decimalsOf(token1);
          p0 = await priceOf(token0);
          p1 = await priceOf(token1);
          if (p0 == null || p1 == null) return { volumeUsd: null, lastSwapAt };
        }
        // amount0/amount1 are signed in V3, unsigned in V2 — we use absolute notional
        const amount0Hex = '0x' + log.data.slice(2, 66);
        const amount1Hex = '0x' + log.data.slice(66, 130);
        const a0 = BigInt(amount0Hex);
        const a1 = BigInt(amount1Hex);
        const abs0 = a0 < 0n ? -a0 : a0;
        const abs1 = a1 < 0n ? -a1 : a1;
        volumeUsd += (Number(abs0) / 10 ** d0) * p0 + (Number(abs1) / 10 ** d1) * p1;
      }
      const lastBlock = logs[logs.length - 1].blockNumber;
      try {
        const blk = await provider.getBlock(lastBlock);
        if (blk) lastSwapAt = new Date(blk.timestamp * 1000);
      } catch {}
    } catch {
      // range too large or transient — skip page
    }
  }
  return { volumeUsd, lastSwapAt };
}

// ============================================================================
// Eligibility: tokens with ≥2 eligible pools across different DEXes
// ============================================================================
export async function getEligibleCrossDexPairs(db, chainId, tvlMin, tvlMax) {
  // Returns rows: token0_addr, token1_addr, array of pools with their dex + pool_addr + type
  const r = await db.query(
    `WITH eligible_pools AS (
       SELECT DISTINCT ON (p.pool_addr)
         p.pool_addr, p.dex, p.pool_type, p.token0_addr, p.token1_addr,
         p.fee_millionths, s.tvl_usd, s.volume_24h_usd
       FROM dry_run_pool_registry p
       JOIN dry_run_liquidity_snapshots s
         ON s.chain_id = p.chain_id AND s.pool_addr = p.pool_addr
       WHERE p.chain_id = $1
         AND s.eligible = TRUE
         AND s.tvl_usd IS NOT NULL
       ORDER BY p.pool_addr, s.observed_at DESC
     )
     SELECT token0_addr, token1_addr,
            COUNT(DISTINCT dex) AS n_dexes,
            array_agg(dex) AS dexes,
            array_agg(pool_addr) AS pool_addrs,
            array_agg(pool_type) AS pool_types,
            array_agg(fee_millionths) AS fees
     FROM eligible_pools
     GROUP BY token0_addr, token1_addr
     HAVING COUNT(DISTINCT dex) >= 2`,
    [chainId],
  );
  return r.rows;
}
