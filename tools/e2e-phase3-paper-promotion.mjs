#!/usr/bin/env node
/**
 * Phase 3 smoke: opportunity paper-enqueue → outbox relay → paper promotion-candidates.
 *
 * Prerequisites: migrated Postgres; **opportunity-service** with `PAPER_TRADING_SERVICE_URL`
 * pointing at paper-trading-service (default http://127.0.0.1:3018); relay enabled
 * (`OUTBOX_RELAY_ENABLED` not `false`); **paper-trading-service** listening.
 *
 * Usage: node tools/e2e-phase3-paper-promotion.mjs
 */

import { randomUUID } from 'node:crypto';

const OPP_URL = (process.env.OPPORTUNITY_SERVICE_URL ?? 'http://127.0.0.1:3010').replace(/\/$/, '');
const PAPER_URL = (process.env.PAPER_TRADING_SERVICE_URL ?? 'http://127.0.0.1:3018').replace(/\/$/, '');

async function waitForMetricsReady(baseUrl, label, maxAttempts = 120) {
  const metricsUrl = `${baseUrl}/metrics`;
  for (let i = 0; i < maxAttempts; i += 1) {
    try {
      const res = await fetch(metricsUrl, { method: 'GET' });
      if (res.ok) {
        return;
      }
    } catch {
      /* retry */
    }
    await sleep(500);
  }
  throw new Error(`${label} did not expose /metrics in time (${metricsUrl})`);
}

async function jsonFetch(url, init) {
  const res = await fetch(url, init);
  const text = await res.text();
  let body = {};
  if (text.length > 0) {
    try {
      body = JSON.parse(text);
    } catch {
      throw new Error(`Non-JSON response ${res.status} from ${url}: ${text.slice(0, 200)}`);
    }
  }
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${url}: ${text.slice(0, 500)}`);
  }
  return body;
}

function assert(cond, msg) {
  if (!cond) {
    throw new Error(msg);
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  await waitForMetricsReady(OPP_URL, 'opportunity-service');
  await waitForMetricsReady(PAPER_URL, 'paper-trading-service');

  const correlationId = randomUUID();
  const instrumentKey = `e2e:phase3:${randomUUID().slice(0, 8)}`;

  const oppCreate = await jsonFetch(`${OPP_URL}/opportunities`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-correlation-id': correlationId },
    body: JSON.stringify({
      correlationId,
      payload: { instrumentKey, source: 'e2e-phase3-paper-promotion' },
    }),
  });
  const opportunityId = oppCreate.id;
  assert(typeof opportunityId === 'string' && opportunityId.length > 0, 'opportunity id');

  const enqueue1 = await jsonFetch(`${OPP_URL}/opportunities/${opportunityId}/paper-enqueue`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-correlation-id': correlationId },
    body: JSON.stringify({ instrumentKey }),
  });
  assert(enqueue1.enqueued === true && enqueue1.paperServiceConfigured === true, 'paper-enqueue #1');
  assert(enqueue1.deduplicated !== true, 'first enqueue should not be deduplicated');

  const enqueue2 = await jsonFetch(`${OPP_URL}/opportunities/${opportunityId}/paper-enqueue`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-correlation-id': correlationId },
    body: JSON.stringify({ instrumentKey }),
  });
  assert(
    enqueue2.enqueued === true && enqueue2.deduplicated === true,
    'second enqueue same key should deduplicate',
  );

  let found = false;
  let candidateId = null;
  for (let i = 0; i < 40; i += 1) {
    const list = await jsonFetch(`${PAPER_URL}/paper/promotion-candidates`, {
      method: 'GET',
      headers: { Accept: 'application/json', 'x-correlation-id': correlationId },
    });
    const items = Array.isArray(list) ? list : list.items ?? [];
    assert(Array.isArray(items), 'promotion list items');
    const candidate = items.find((row) => row.opportunityId === opportunityId);
    if (candidate) {
      found = true;
      candidateId = candidate.id;
      break;
    }
    await sleep(500);
  }
  assert(found, 'promotion candidate not visible in paper after relay (timeout ~20s)');
  assert(candidateId !== null, 'candidate id should be set');

  // Test: approve promotion candidate
  console.log('Testing approve promotion candidate...');
  const approveResult = await jsonFetch(
    `${PAPER_URL}/paper/promotion-candidates/${candidateId}/approve`,
    {
      method: 'POST',
      headers: {
        'x-operator-id': 'e2e-test',
      },
    },
  );
  assert(approveResult.status === 'promoted', 'candidate should be promoted');

  // Test: create paper trade and test approve/reject/cancel
  console.log('Testing paper trade mutations...');
  const tradeCreate = await jsonFetch(`${PAPER_URL}/paper/trades`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      instrumentKey: `e2e:phase3:trade:${randomUUID().slice(0, 8)}`,
      notional: '1000.00',
      routeKey: 'eth-usdt',
    }),
  });
  const tradeId = tradeCreate.id;
  assert(tradeCreate.state === 'draft', 'trade should start in draft state');

  // Test: approve paper trade (should create virtual capital reservation)
  const tradeApprove = await jsonFetch(`${PAPER_URL}/paper/trades/${tradeId}/approve`, {
    method: 'POST',
    headers: {
      'x-operator-id': 'e2e-test',
    },
  });
  assert(tradeApprove.state === 'active', 'trade should be active after approve');

  // Test: create another trade and reject it
  const tradeCreate2 = await jsonFetch(`${PAPER_URL}/paper/trades`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      instrumentKey: `e2e:phase3:trade:${randomUUID().slice(0, 8)}`,
      notional: '500.00',
    }),
  });
  const tradeId2 = tradeCreate2.id;
  const tradeReject = await jsonFetch(`${PAPER_URL}/paper/trades/${tradeId2}/reject`, {
    method: 'POST',
    headers: {
      'x-operator-id': 'e2e-test',
    },
  });
  assert(tradeReject.state === 'canceled', 'trade should be canceled after reject');

  // Test: cancel active trade (should expire virtual capital reservation)
  const tradeCancel = await jsonFetch(`${PAPER_URL}/paper/trades/${tradeId}/cancel`, {
    method: 'POST',
    headers: {
      'x-operator-id': 'e2e-test',
    },
  });
  assert(tradeCancel.state === 'canceled', 'trade should be canceled after cancel');

  console.log('e2e-phase3-paper-promotion: ok', {
    opportunityId,
    instrumentKey,
    candidateId,
    tradeId,
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
