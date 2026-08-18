#!/usr/bin/env node
/**
 * PLAN14 #58 event-trigger smoke — two parts:
 *
 *  1. ALIVE getLogs smoke (DoD-1, the Hermes condition): getLogs over ALL
 *     alive pool addresses of every chain, chunked by event.chunkAddrs, over
 *     the last --window-min minutes. PASS = every chunk ≤ 5s and each chain's
 *     total fits inside event.pollSeconds. Topic0 counts confirm the V2 topic
 *     live (the 2026-08-18 pre-smoke window was V2-quiet).
 *
 *  2. --fixture: synthetic large-swap fixture (DoD-2): arms the raw tier (one
 *     real raw pass), picks the deepest cross-chain heuristic token, injects a
 *     fabricated V3-shaped Swap log sized to 25% of its pool depth, and drives
 *     the REAL event pipeline (decode → size → gates → quote → cc-obs →
 *     Stage 3 → run_stats). Verifies cc-obs rows with run_id 'event-<uuid>',
 *     metadata.trigger='event' (+ smoke marker) and run_stats source='event'.
 *     Rows are real venue quotes — only the trigger moment is synthetic.
 *
 * Usage (needs the probe env: PROBE_RPC_*_URL + PROBE_DATABASE_URL):
 *   node tools/probe-event-smoke.mjs                    # DoD-1 only
 *   node tools/probe-event-smoke.mjs --fixture          # DoD-1 + DoD-2
 *   node tools/probe-event-smoke.mjs --window-min 30    # wider scan window
 */

import { ethers } from 'ethers';
import { randomUUID } from 'node:crypto';
import {
  pollSwapEvents, runRawTier, alivePoolsForEvent,
  db, providers, config, CHAIN_IDS, EVENT_CFG, rawTierState,
} from './probe-dry-run.mjs';
import { SWAP_V3_TOPIC, SWAP_V2_TOPIC } from './probe-discovery.mjs';

const args = process.argv.slice(2);
const WITH_FIXTURE = args.includes('--fixture');
const VERBOSE = args.includes('--verbose');
const flagArg = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  const v = i >= 0 ? args[i + 1] : undefined;
  const n = Number(v);
  return v != null && Number.isFinite(n) ? n : dflt;
};
const windowMin = flagArg('window-min', 5);
const BLOCK_TIME_SEC = { 42161: 0.25, 8453: 2, 10: 2 };
const CHUNK_LIMIT_MS = 5000; // DoD-1: each chunk ≤ 5s

const word = (n) => BigInt(n).toString(16).padStart(64, '0');
const wordSigned = (n) => (n >= 0n ? word(n) : word((1n << 256n) + n));

// ── Part 1: alive getLogs smoke (DoD-1) ──────────────────────────────────────
async function aliveSmoke() {
  console.log(`\n=== DoD-1: alive getLogs smoke (window ${windowMin} min, chunks of ${EVENT_CFG.chunkAddrs}) ===`);
  let ok = true;
  let totalV2 = 0;
  for (const chainId of CHAIN_IDS) {
    const pools = await alivePoolsForEvent(chainId);
    const addrs = [...pools.keys()];
    const latest = await providers[chainId].getBlockNumber();
    const blocks = Math.max(1, Math.round((windowMin * 60) / (BLOCK_TIME_SEC[chainId] ?? 2)));
    const fromBlock = Math.max(0, latest - blocks);
    const chunkSize = Math.min(500, Math.max(50, Number(EVENT_CFG.chunkAddrs ?? 150)));
    const PAGE_BLOCKS = 5000; // BlockPi hard limit per getLogs (Arb 0.25s/block: 120min = 28.8K blocks)
    let logs = 0, v3 = 0, v2 = 0, maxChunkMs = 0, totalMs = 0, chunkNo = 0, chunkFails = 0;
    for (let pageFrom = fromBlock; pageFrom <= latest; pageFrom += PAGE_BLOCKS) {
      const pageTo = Math.min(pageFrom + PAGE_BLOCKS - 1, latest);
      for (let b = 0; b < addrs.length; b += chunkSize) {
      const chunk = addrs.slice(b, b + chunkSize);
      const t0 = Date.now();
      let batch = null;
      let failWhy = '';
      try {
        batch = await providers[chainId].getLogs({
          address: chunk,
          topics: [[SWAP_V3_TOPIC, SWAP_V2_TOPIC]],
          fromBlock: pageFrom, toBlock: pageTo,
        });
      } catch (e) {
        chunkFails += 1;
        failWhy = e.message.slice(0, 120); // a swallowed reason is a hidden bug — print it
      }
      const ms = Date.now() - t0;
      chunkNo += 1;
      totalMs += ms;
      maxChunkMs = Math.max(maxChunkMs, ms);
      if (batch) {
        logs += batch.length;
        for (const l of batch) {
          if (l.topics[0] === SWAP_V3_TOPIC) v3 += 1;
          else if (l.topics[0] === SWAP_V2_TOPIC) v2 += 1;
        }
      }
      if (VERBOSE || failWhy) console.log(`  [chain ${chainId}] chunk ${chunkNo} (${chunk.length} addrs, blocks ${pageFrom}-${pageTo}): ${batch ? batch.length : `FAIL ${failWhy}`} in ${ms}ms`);
      }
    }
    totalV2 += v2;
    const chunkOk = maxChunkMs <= CHUNK_LIMIT_MS && chunkFails === 0;
    const budgetOk = totalMs <= Number(EVENT_CFG.pollSeconds ?? 30) * 1000;
    if (!chunkOk || !budgetOk) ok = false;
    console.log(
      `chain ${chainId} (${config.chains[chainId].name}): pools=${addrs.length} chunks=${chunkNo} `
      + `logs=${logs} (v3=${v3} v2=${v2}) maxChunk=${maxChunkMs}ms total=${totalMs}ms `
      + `${chunkFails ? `FAILED_CHUNKS=${chunkFails} ` : ''}${chunkOk && budgetOk ? 'OK' : 'FAIL'}`,
    );
  }
  if (totalV2 === 0) {
    console.log('NOTE: zero V2-topic logs in the window — DoD-1 wants a live V2 confirmation; widen --window-min or rerun during V2 activity (sushi Arb / velodrome OP / aerodrome Base)');
  }
  console.log(`DoD-1 ${ok ? 'PASS' : 'FAIL'}`);
  return ok;
}

// ── Part 2: synthetic fixture through the real pipeline (DoD-2) ──────────────
async function fixtureSmoke() {
  console.log('\n=== DoD-2: synthetic large-swap fixture → event quote ===');
  // 1) arm the event tier with one REAL raw pass (groups + raw prices)
  console.log('[fixture] running one raw pass to arm crosschain groups (~30-90s)...');
  const rawRunId = `event-smoke-raw-${randomUUID()}`;
  await runRawTier(rawRunId);
  if (!rawTierState.ok || !rawTierState.tokenIndex?.size) {
    console.log('DoD-2 FAIL: raw tier did not arm (no crosschain groups)');
    return false;
  }

  // 2) deepest heuristic (non-canonical) crosschain group
  const groups = Object.entries(rawTierState.crossGroups)
    .filter(([, g]) => !g.canonical)
    .map(([gk, g]) => ({ gk, g, depth: Math.max(...Object.values(g.chains).map((e) => e.depthUsd ?? 0)) }))
    .sort((a, b) => b.depth - a.depth);
  if (groups.length === 0) {
    console.log('DoD-2 FAIL: no heuristic crosschain groups in raw state');
    return false;
  }

  // 3) find an alive pool on some chain holding that group's token
  let pool = null, chainId = null, ent = null;
  outer: for (const { g } of groups) {
    for (const [cid, e] of Object.entries(g.chains)) {
      const pools = await alivePoolsForEvent(Number(cid));
      const addrL = e.addr.toLowerCase();
      let best = null;
      for (const [pa, p] of pools) {
        if (p.token0.toLowerCase() === addrL || p.token1.toLowerCase() === addrL) {
          if (!best || p.tvlUsd > best.tvlUsd) best = { pa, ...p };
        }
      }
      if (best) { pool = best; chainId = Number(cid); ent = e; break outer; }
    }
  }
  if (!pool) {
    console.log('DoD-2 FAIL: no alive pool holds any heuristic crosschain token');
    return false;
  }
  const tokenIs0 = pool.token0.toLowerCase() === ent.addr.toLowerCase();

  // 4) size the synthetic swap: comfortably above max($500, 10% depth)
  const price = Number((await db.query(
    `SELECT price_marginal_usd FROM dry_run_raw_token_prices
      WHERE chain_id = $1 AND token_addr = $2 ORDER BY observed_at DESC LIMIT 1`,
    [chainId, ent.addr.toLowerCase()],
  )).rows[0]?.price_marginal_usd);
  if (!(price > 0)) {
    console.log('DoD-2 FAIL: no raw price for the picked token');
    return false;
  }
  const decErc20 = new ethers.Contract(ent.addr, ['function decimals() view returns (uint8)'], providers[chainId]);
  const decimals = Number(await decErc20.decimals());
  const targetUsd = Math.max(Number(EVENT_CFG.minSwapUsd) * 1.5, pool.tvlUsd * 0.25);
  const amountRaw = BigInt(Math.round((targetUsd / price) * 10 ** decimals));
  console.log(`[fixture] token ${ent.symbol} ${ent.addr} chain ${chainId}, pool ${pool.pa} tvl=$${pool.tvlUsd.toFixed(0)} → synthetic swap $${targetUsd.toFixed(0)} (${amountRaw} raw units)`);

  // 5) inject the V3-shaped log into the REAL pipeline
  const log = {
    address: pool.pa,
    topics: [SWAP_V3_TOPIC],
    data: '0x' + (tokenIs0 ? wordSigned(-amountRaw) + wordSigned(0n) : wordSigned(0n) + wordSigned(amountRaw)),
    blockNumber: await providers[chainId].getBlockNumber(),
  };
  const res = await pollSwapEvents({ fixture: { chainId, logs: [log], smoke: true } });
  console.log(`[fixture] pipeline result: quoted=${res.quoted} candidates=${res.candidates}`);
  if (res.quoted === 0) {
    console.log('DoD-2 FAIL: fixture produced no event quote (gates or quote path — see log above)');
    return false;
  }

  // 6b) DoD-6 negative fixture: a HUGE swap on a canonical token (e.g. WETH)
  // must NOT produce an event quote — majors are the normal market.
  const canon = Object.values(rawTierState.crossGroups).find((g) => g.canonical && !g.collision);
  if (canon) {
    let cPool = null, cChain = null, cEnt = null;
    outerCanon: for (const [cid, e] of Object.entries(canon.chains)) {
      const pools = await alivePoolsForEvent(Number(cid));
      const addrL = e.addr.toLowerCase();
      for (const [pa, p] of pools) {
        if (p.token0.toLowerCase() === addrL || p.token1.toLowerCase() === addrL) {
          if (!cPool || p.tvlUsd > cPool.tvlUsd) { cPool = { pa, ...p }; cChain = Number(cid); cEnt = e; }
        }
      }
      if (cPool) break outerCanon;
    }
    if (cPool) {
      const cDec = Number(await new ethers.Contract(cEnt.addr, ['function decimals() view returns (uint8)'], providers[cChain]).decimals());
      // $100K-equivalent of the canonical token — huge by any gate
      const cAmount = BigInt(Math.round(100_000 * 10 ** cDec));
      const cLog = {
        address: cPool.pa,
        topics: [SWAP_V3_TOPIC],
        data: '0x' + wordSigned(cPool.token0.toLowerCase() === cEnt.addr.toLowerCase() ? -cAmount : 0n)
          + wordSigned(cPool.token0.toLowerCase() === cEnt.addr.toLowerCase() ? 0n : cAmount),
        blockNumber: await providers[cChain].getBlockNumber(),
      };
      const cRes = await pollSwapEvents({ fixture: { chainId: cChain, logs: [cLog], smoke: true } });
      console.log(`[fixture] canonical negative: $100K ${cEnt.symbol} swap → quoted=${cRes.quoted} (expected 0)`);
      if (cRes.quoted !== 0) {
        console.log('DoD-6 FAIL: canonical token was event-quoted');
        return false;
      }
      console.log('DoD-6 PASS (canonical not event-quoted)');
    } else {
      console.log('NOTE: no alive pool for a canonical token — DoD-6 negative case skipped');
    }
  }

  // 7) verify the written rows
  const cc = await db.query(
    `SELECT run_id, token, notional_usd, net_pp_bps, metadata->>'trigger' AS trigger, metadata->>'smoke' AS smoke
       FROM dry_run_cross_chain_observations
      WHERE run_id LIKE 'event-%' AND observed_at > now() - interval '3 minutes'
      ORDER BY id DESC LIMIT 6`,
  );
  const stats = await db.query(
    `SELECT run_id, chain_id, rpc_calls, cycle_ms FROM dry_run_run_stats
      WHERE source = 'event' AND observed_at > now() - interval '3 minutes'`,
  );
  const ccOk = cc.rows.length > 0 && cc.rows.every((r) => r.trigger === 'event');
  console.log(`  cc-obs rows (event, ≤3min): ${cc.rows.length}`);
  for (const r of cc.rows.slice(0, 4)) {
    console.log(`    ${r.run_id.slice(0, 18)}… ${r.token} $${r.notional_usd} net_pp=${r.net_pp_bps ?? 'null'} trigger=${r.trigger} smoke=${r.smoke}`);
  }
  console.log(`  run_stats rows (source='event'): ${stats.rows.length} — ${stats.rows.map((r) => `chain ${r.chain_id}: rpc=${r.rpc_calls} ms=${r.cycle_ms}`).join(', ')}`);
  const ok = ccOk && stats.rows.length > 0;
  console.log(`DoD-2 ${ok ? 'PASS' : 'FAIL'}`);
  return ok;
}

// ── main ─────────────────────────────────────────────────────────────────────
const t0 = Date.now();
let ok = true;
try {
  ok = (await aliveSmoke()) && ok;
  if (WITH_FIXTURE) ok = (await fixtureSmoke()) && ok;
} catch (e) {
  console.error(`smoke crashed: ${e.stack ?? e.message}`);
  ok = false;
} finally {
  try { await db.end(); } catch { /* pool already closed */ }
}
console.log(`\nSmoke ${ok ? 'PASS' : 'FAIL'} in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
process.exit(ok ? 0 : 1);
