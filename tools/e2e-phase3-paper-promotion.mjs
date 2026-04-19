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
  for (let i = 0; i < 40; i += 1) {
    const list = await jsonFetch(`${PAPER_URL}/paper/promotion-candidates`, {
      method: 'GET',
      headers: { Accept: 'application/json', 'x-correlation-id': correlationId },
    });
    const items = Array.isArray(list) ? list : list.items ?? [];
    assert(Array.isArray(items), 'promotion list items');
    if (items.some((row) => row.opportunityId === opportunityId)) {
      found = true;
      break;
    }
    await sleep(500);
  }
  assert(found, 'promotion candidate not visible in paper after relay (timeout ~20s)');

  console.log('e2e-phase3-paper-promotion: ok', { opportunityId, instrumentKey });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
