#!/usr/bin/env node
/**
 * PAD-8 E2E smoke: drives one promotion candidate end-to-end through the AutoDriveWorker.
 *
 * Flow:
 *   1. POST /paper/promotion-candidates with v1.1 P/L payload (netProfitUsd, evidence.buyPrice/sellPrice).
 *   2. PATCH candidate → under_review → POST approve → promoted (operator step — the paper→live gate).
 *   3. Wait for AutoDriveWorker phase A → paper_trades (state=draft) created from the candidate.
 *   4. Wait for phase B (PAPER_AUTO_APPROVE=true) → state=active.
 *   5. Wait for phase C (after autoSettleDelayMs) → state=settled, profit_usd populated.
 *   6. Assert /paper/trades/history and /paper/trades/stats return the settled trade.
 *
 * Env: PAPER_API_BASE (default http://127.0.0.1:3018).
 * Requires paper-trading-service running with:
 *   PAPER_AUTO_DRIVE_ENABLED=true, PAPER_AUTO_APPROVE=true, PAPER_AUTO_DRIVE_INTERVAL_MS=1000,
 *   PAPER_AUTO_SETTLE_DELAY_MS=1000, PAPER_AUTO_DRIVE_MIN_NET_PROFIT_USD=1, PAPER_NOTIONAL_USD=1000.
 */
import assert from 'node:assert';

const PAPER_API_BASE = process.env.PAPER_API_BASE ?? 'http://127.0.0.1:3018';
const POLL_MS = 500;
const PHASE_A_TIMEOUT_MS = 15_000;
const PHASE_BC_TIMEOUT_MS = 30_000;

async function api(method, path, body) {
  // Only set Content-Type: application/json when there IS a body — Fastify rejects
  // "Content-Type: application/json" + empty body with 400 "Body cannot be empty".
  // The approve/reject/ settle-without-body endpoints accept no body at all.
  const headers = { Accept: 'application/json' };
  let serialized;
  if (body !== undefined) {
    serialized = JSON.stringify(body);
    headers['Content-Type'] = 'application/json';
  }
  const res = await fetch(`${PAPER_API_BASE}${path}`, {
    method,
    headers,
    body: serialized,
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`${method} ${path} → ${res.status}: ${text.slice(0, 300)}`);
  }
  return text.length > 0 ? JSON.parse(text) : null;
}

async function waitFor(predicate, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  let lastErr = null;
  while (Date.now() < deadline) {
    try {
      const r = await predicate();
      if (r) return r;
    } catch (err) {
      lastErr = err;
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
  throw new Error(`waitFor(${label}) timed out after ${timeoutMs}ms${lastErr !== null ? ` (last err: ${lastErr.message})` : ''}`);
}

async function listTradesByOpportunity(opportunityId) {
  const all = (await api('GET', '/paper/trades')).items ?? [];
  return all.filter((t) => t.opportunityId === opportunityId);
}

async function main() {
  console.log(`>> PAD-8 e2e: PAPER_API_BASE=${PAPER_API_BASE}`);

  // 1. Create promotion candidate with rich P/L payload.
  const instrumentKey = `e2e-autodrive-${Date.now()}`;
  const opportunityId = cryptoRandom();
  const candidate = await api('POST', '/paper/promotion-candidates', {
    instrumentKey,
    opportunityId,
    source: 'e2e-autodrive',
    score: 8,
    evidence: { netProfitUsd: 25, spreadBps: 35, buyVenue: 'uni-v2', sellVenue: 'sushi', buyPrice: 100, sellPrice: 100.25 },
    enqueueIdempotencyKey: `e2e-autodrive-${opportunityId}`,
    netProfitUsd: 25,
    spreadBps: 35,
    buyVenue: 'uni-v2',
    sellVenue: 'sushi',
  });
  console.log(`>> candidate created: ${candidate.id} (instrument=${instrumentKey})`);

  // 2. Operator promotes: queued → under_review → promoted.
  await api('PATCH', `/paper/promotion-candidates/${candidate.id}`, {
    expectedVersion: candidate.entityVersion,
    status: 'under_review',
  });
  const promoted = await api('POST', `/paper/promotion-candidates/${candidate.id}/approve`);
  assert.equal(promoted.status, 'promoted', `expected promoted, got ${promoted.status}`);
  console.log('>> candidate promoted (operator gate passed)');

  // 3. Wait for phase A — a paper trade created from the candidate (any non-terminal state).
  // The pipeline runs fast at CI intervals (1s tick, 1s settle delay): by the time we poll,
  // the trade may already be past draft/active. We assert the TRADE EXISTS linked to our
  // candidate's opportunityId (the auto-drive idempotency key is internal — not exposed in
  // tradeView, so we verify via opportunityId which IS in the API response).
  const trade = await waitFor(async () => {
    const ts = await listTradesByOpportunity(opportunityId);
    return ts.length > 0 ? ts[0] : null;
  }, PHASE_A_TIMEOUT_MS, 'phaseA-trade-created');
  console.log(`>> phase A: paper trade created: ${trade.id} (state=${trade.state})`);
  assert.equal(
    trade.opportunityId,
    opportunityId,
    `trade.opportunityId should match the candidate's opportunityId`,
  );

  // 4+5. Wait for the pipeline to reach the terminal settled state with P/L populated.
  // Phases B (auto-approve) and C (auto-settle after delay) run on subsequent ticks.
  const settledTrade = await waitFor(async () => {
    const ts = await listTradesByOpportunity(opportunityId);
    return ts.length > 0 && ts[0].state === 'settled' ? ts[0] : null;
  }, PHASE_BC_TIMEOUT_MS, 'phaseBC-settled');
  console.log(`>> phases B+C: trade settled, profitUsd=${settledTrade.profitUsd}`);
  assert.notEqual(settledTrade.profitUsd, null, 'profitUsd must be populated after settle');
  assert.equal(
    settledTrade.entryPrice !== null && settledTrade.exitPrice !== null,
    true,
    'entry/exit prices must be populated',
  );

  // 6. Verify /history and /stats expose the settled trade.
  const history = await api('GET', '/paper/trades/history?limit=50');
  const inHistory = (history.items ?? []).some((t) => t.id === settledTrade.id);
  assert.equal(inHistory, true, 'settled trade must appear in /paper/trades/history');
  const stats = await api('GET', '/paper/trades/stats');
  assert.equal(Number(stats.total) >= 1, true, 'stats.total must be ≥ 1');
  console.log(`>> /history + /stats OK (stats.total=${stats.total}, winRate=${stats.winRate})`);

  console.log('>> PAD-8 e2e: PASS');
}

function cryptoRandom() {
  // UUID v4 without depending on node:crypto/webcrypto version specifics.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

main().catch((err) => {
  console.error('>> PAD-8 e2e: FAIL');
  console.error(err);
  process.exit(1);
});
