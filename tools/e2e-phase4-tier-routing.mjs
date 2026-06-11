#!/usr/bin/env node
/**
 * Phase 4: market-intake tier routing + warm/cold sampling throttle (429).
 *
 * Prerequisites:
 *   - `npm run db:migrate` (includes 029 intake policy seed)
 *   - risk-service on RISK_SERVICE_URL (default :3000) for watchlist tiers API
 *   - config-service on CONFIG_SERVICE_URL / CONFIG_API_BASE (default :3019)
 *   - market-intake-service on MARKET_INTAKE_SERVICE_URL (default :3015)
 *   - INTAKE_THROTTLING_ENABLED=true on intake process
 *
 * Usage:
 *   DATABASE_URL=... INTAKE_THROTTLING_ENABLED=true \
 *   node tools/e2e-phase4-tier-routing.mjs
 */

const RISK_URL = (process.env.RISK_SERVICE_URL ?? 'http://127.0.0.1:3000').replace(
  /\/$/,
  '',
);
const INTAKE_URL = (
  process.env.MARKET_INTAKE_SERVICE_URL ?? 'http://127.0.0.1:3015'
).replace(/\/$/, '');

function assert(cond, msg) {
  if (!cond) {
    throw new Error(msg);
  }
}

async function waitOk(url, path, deadlineMs = 90_000) {
  const deadline = Date.now() + deadlineMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${url}${path}`);
      if (res.ok) {
        return;
      }
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`${url}${path} not ready`);
}

function isoNow() {
  return new Date().toISOString();
}

async function postIngest(body) {
  const res = await fetch(`${INTAKE_URL}/snapshots/ingest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json = {};
  if (text.length > 0) {
    try {
      json = JSON.parse(text);
    } catch {
      json = { raw: text };
    }
  }
  return { status: res.status, json };
}

async function main() {
  if (process.env.INTAKE_THROTTLING_ENABLED !== 'true') {
    throw new Error(
      'INTAKE_THROTTLING_ENABLED must be "true" for this e2e (tier sampling throttle)',
    );
  }

  await waitOk(RISK_URL, '/metrics');
  await waitOk(INTAKE_URL, '/metrics');

  const deg = await fetch(`${INTAKE_URL}/health/degradation`);
  assert(deg.ok, `GET /health/degradation expected 2xx, got ${deg.status}`);
  const degBody = await deg.json();
  assert(
    typeof degBody.fallbackMode === 'boolean',
    'degradation payload should include fallbackMode: boolean',
  );
  assert(
    typeof degBody.intakeThrottlingEnabled === 'boolean',
    'degradation payload should include intakeThrottlingEnabled: boolean',
  );

  // Hot tier (BTC): should allow without sampling interval.
  const hot1 = await postIngest({
    venueCode: 'e2e',
    venueSymbol: 'BTC-PERP',
    instrumentKey: 'BTC',
    observedAt: isoNow(),
    bid: 1,
    ask: 2,
  });
  assert(hot1.status === 201, `hot ingest expected 201, got ${hot1.status}`);

  // Warm tier (SOL): second ingest within warmSampleIntervalMs -> 429 (same sampling key i:SOL).
  const warmBody = {
    venueCode: 'e2e',
    venueSymbol: 'SOL-PERP',
    instrumentKey: 'SOL',
    observedAt: isoNow(),
    bid: 1,
    ask: 2,
  };
  const w1 = await postIngest(warmBody);
  assert(w1.status === 201, `warm first ingest expected 201, got ${w1.status}`);

  const w2 = await postIngest({
    ...warmBody,
    observedAt: isoNow(),
  });
  assert(
    w2.status === 429,
    `warm second ingest expected 429 (sampled), got ${w2.status} ${JSON.stringify(w2.json)}`,
  );
  assert(w2.json?.throttled === true, '429 body should include throttled: true');

  const metrics = await fetch(`${INTAKE_URL}/metrics`);
  assert(metrics.ok, 'GET /metrics should succeed');
  const mt = await metrics.text();
  assert(
    mt.includes('arb_intake_'),
    'metrics should expose arb_intake_* counters',
  );

  console.log('e2e-phase4-tier-routing: ok');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
