#!/usr/bin/env node
/**
 * Phase 2.2 policy writers smoke: seed token/route profiles + optional risk_decisions,
 * POST job triggers on risk-service, verify GET read APIs.
 *
 * Prerequisites: `npm run db:migrate`, risk-service on PORT (default 3000),
 * env `RISK_POLICY_JOB_TRIGGER_TOKEN` (must match risk-service process env).
 *
 * Usage:
 *   DATABASE_URL=... RISK_POLICY_JOB_TRIGGER_TOKEN=dev RISK_SERVICE_URL=http://127.0.0.1:3000 node tools/e2e-phase2-watchlist-route-scoring.mjs
 */

import pg from 'pg';

const RISK_URL = (process.env.RISK_SERVICE_URL ?? 'http://127.0.0.1:3000').replace(/\/$/, '');
const DATABASE_URL = process.env.DATABASE_URL;
const TRIGGER = process.env.RISK_POLICY_JOB_TRIGGER_TOKEN?.trim();

async function jsonFetch(url, init) {
  const res = await fetch(url, init);
  const text = await res.text();
  let body = {};
  if (text.length > 0) {
    try {
      body = JSON.parse(text);
    } catch {
      throw new Error(`Non-JSON ${res.status} from ${url}: ${text.slice(0, 200)}`);
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

async function waitMetricsOk() {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${RISK_URL}/metrics`);
      if (res.ok) {
        return;
      }
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('risk-service /metrics not ready');
}

async function main() {
  if (!DATABASE_URL) {
    throw new Error('DATABASE_URL is required for seed SQL');
  }
  if (!TRIGGER) {
    throw new Error('RISK_POLICY_JOB_TRIGGER_TOKEN is required (must match risk-service env)');
  }

  await waitMetricsOk();

  const client = new pg.Client({ connectionString: DATABASE_URL });
  await client.connect();
  try {
    await client.query(
      `INSERT INTO token_profiles (instrument_key, max_notional_usd) VALUES ($1, $2)
       ON CONFLICT (instrument_key) DO UPDATE SET max_notional_usd = EXCLUDED.max_notional_usd`,
      ['e2e-tier-smoke', 2_000_000],
    );
    await client.query(
      `INSERT INTO route_profiles (route_key, max_notional_usd) VALUES ($1, $2)
       ON CONFLICT (route_key) DO UPDATE SET max_notional_usd = EXCLUDED.max_notional_usd`,
      ['e2e-route-scoring-smoke', 1_000_000],
    );
    await client.query(
      `INSERT INTO risk_decisions (correlation_id, plan_reference, outcome, reasons, snapshot_version, notional_usd, route_key)
       VALUES ($1, $2, 'approved', '[]'::jsonb, 1, 100, $3)`,
      [`e2e-rs-${Date.now()}`, 'e2e-plan', 'e2e-route-scoring-smoke'],
    );
  } finally {
    await client.end();
  }

  const headers = {
    'x-arbibot-job-trigger': TRIGGER,
  };

  const w = await jsonFetch(`${RISK_URL}/policy/jobs/watchlist-tiering`, {
    method: 'POST',
    headers,
  });
  assert(typeof w.snapshotsWritten === 'number', 'watchlist job response');

  const tiers = await jsonFetch(`${RISK_URL}/policy/watchlist/tiers`);
  assert(Array.isArray(tiers.items), 'watchlist tiers items');
  const hit = tiers.items.some((r) => r.instrumentKey === 'e2e-tier-smoke');
  assert(hit, 'expected e2e-tier-smoke in watchlist tiers');

  const rs = await jsonFetch(`${RISK_URL}/policy/jobs/route-scoring`, {
    method: 'POST',
    headers,
  });
  assert(typeof rs.rowsWritten === 'number', 'route scoring job response');

  const hist = await jsonFetch(
    `${RISK_URL}/policy/route-scoring-history/${encodeURIComponent('e2e-route-scoring-smoke')}`,
  );
  assert(Array.isArray(hist.items), 'route scoring history items');
  assert(hist.items.length >= 1, 'expected at least one scoring row');

  console.log('e2e-phase2-watchlist-route-scoring: OK');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
