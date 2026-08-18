#!/usr/bin/env node
/**
 * PLAN14 #57 — coverage audit gate («ничего из подключённых источников не
 * ускользает»). Compares DefiLlama's pool list (per mapped project/chain)
 * against dry_run_pool_registry and prints the gap as a number per venue.
 * The Sushi=0 hole would have been caught here automatically.
 *
 * Usage (server):
 *   curl -sS https://yields.llama.fi/pools -o /tmp/llama_pools.json
 *   node tools/probe-coverage-audit.mjs [--min-tvl 0]
 *
 * SELECT-only + local JSON read; no RPC.
 */
import { readFileSync } from 'node:fs';
import pg from 'pg';

const LLAMA_PATH = '/tmp/llama_pools.json';
const MIN_TVL = (() => {
  const i = process.argv.indexOf('--min-tvl');
  return i > 0 ? Number(process.argv[i + 1]) || 0 : 0;
})();

// same mapping as tools/seed-registry-defillama.mjs (single source of truth
// lives there; this copy is the audit's independent view)
const PROJECTS = {
  42161: { 'camelot-v3': 'camelot', 'uniswap-v3': 'uniswap-v3', sushiswap: 'sushiswap-v2' },
  8453: { 'uniswap-v3': 'uniswap-v3', 'aerodrome-v1': 'aerodrome-v2', 'aerodrome-slipstream': 'aerodrome-slipstream' },
  10: { 'uniswap-v3': 'uniswap-v3', 'velodrome-v2': 'velodrome-v2', 'velodrome-v3': 'velodrome-slipstream' },
};
const CHAIN_MAP = { Arbitrum: 42161, Base: 8453, 'OP Mainnet': 10 };

const dbUrl = process.env.PROBE_DATABASE_URL ?? process.env.DATABASE_URL;
if (!dbUrl) {
  console.error('PROBE_DATABASE_URL (or DATABASE_URL) required');
  process.exit(1);
}
const db = new pg.Pool({ connectionString: dbUrl, max: 2 });
db.on('error', (e) => console.error(`[pg pool] ${e.message}`));

try {
  const raw = JSON.parse(readFileSync(LLAMA_PATH, 'utf8'));
  const pools = raw.data ?? raw;
  const llama = {}; // `${chain}:${dex}` → count
  for (const p of pools) {
    const chainId = CHAIN_MAP[p.chain];
    if (!chainId) continue;
    const dex = PROJECTS[chainId]?.[p.project];
    if (!dex) continue;
    if ((p.tvlUsd ?? 0) < MIN_TVL) continue;
    if (!Array.isArray(p.underlyingTokens) || p.underlyingTokens.length !== 2) continue;
    const k = `${chainId}:${dex}`;
    llama[k] = (llama[k] ?? 0) + 1;
  }
  const reg = await db.query('SELECT chain_id, dex, COUNT(*) AS n FROM dry_run_pool_registry GROUP BY 1,2');
  const registry = {};
  for (const row of reg.rows) registry[`${row.chain_id}:${row.dex}`] = Number(row.n);

  console.log(`# coverage audit ${new Date().toISOString()} (llama min tvl $${MIN_TVL})`);
  console.log('chain:venue              llama   registry   coverage');
  let worst = null;
  const keys = new Set([...Object.keys(llama), ...Object.keys(registry)]);
  for (const k of [...keys].sort()) {
    const l = llama[k] ?? 0;
    const r = registry[k] ?? 0;
    // registry can exceed llama (event discovery finds pools llama doesn't list)
    const cov = l === 0 ? (r > 0 ? 'n/a (llama lists none)' : '—') : `${Math.min(100, Math.round((r / l) * 100))}%`;
    console.log(`${k.padEnd(24)} ${String(l).padStart(5)} ${String(r).padStart(10)}   ${cov}`);
    if (l > 0 && (worst == null || r / l < worst.ratio)) worst = { k, l, r, ratio: r / l };
  }
  if (worst) {
    const pct = Math.round(worst.ratio * 100);
    if (pct < 95) {
      console.log(`\n[WORST] ${worst.k}: ${pct}% (${worst.r}/${worst.l}) — below the 95% gate, investigate`);
      process.exitCode = 2;
    } else {
      console.log(`\n[OK] worst venue ${worst.k} at ${pct}% — ≥95% gate satisfied`);
    }
  }
} catch (e) {
  console.error(`audit failed: ${e.message}`);
  process.exitCode = 1;
} finally {
  await db.end();
}
