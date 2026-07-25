#!/usr/bin/env node
/**
 * Scanner-service runtime smoke (stub — S5-4-CI).
 *
 * Verifies the runtime wiring against a LIVE scanner-service: health, metrics exposure,
 * and the 3 read-only endpoints (instances, findings, status). This is the HTTP-level
 * counterpart to the static `ci-scanner-smoke.sh` — it catches regressions that only show
 * up when NestJS actually boots (DI failures, missing env, route registration order).
 *
 * Prerequisites: scanner-service listening (default http://127.0.0.1:3021) with a migrated
 * Postgres + config-service reachable for `scanner.*` keys. No RPC URLs required for these
 * read-only endpoints (they return empty lists / worker status without calling chains).
 *
 * Usage: node tools/e2e-scanner-smoke.mjs
 *
 * To extend (future): feed a synthetic finding via direct DB insert and assert it appears
 * in GET /scanner/findings, then POST /scanner/findings/:id/re-publish against a stub
 * opportunity-service. Out of scope for the S5-4 stub — the manual runtime smoke in
 * scanner-harness-runbook.md §3 covers the full RPC → finding → POST /opportunities path.
 */

const SCANNER_URL = (
  process.env.SCANNER_API_BASE ??
  'http://127.0.0.1:3021'
).replace(/\/$/, '');

async function jsonFetch(url) {
  const res = await fetch(url, { method: 'GET' });
  const text = await res.text();
  let body = null;
  if (text.length > 0) {
    try {
      body = JSON.parse(text);
    } catch {
      body = { raw: text };
    }
  }
  return { status: res.status, body };
}

function assert(cond, msg) {
  if (!cond) {
    console.error(`[FAIL] ${msg}`);
    process.exitCode = 1;
  } else {
    console.log(`[ok]   ${msg}`);
  }
}

async function waitForHealth(maxAttempts = 60) {
  for (let i = 0; i < maxAttempts; i += 1) {
    try {
      const res = await fetch(`${SCANNER_URL}/health`, { method: 'GET' });
      if (res.ok) return;
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`scanner-service did not expose /health at ${SCANNER_URL} in time`);
}

async function main() {
  console.log('── e2e-scanner-smoke ──\n');
  await waitForHealth();
  console.log(`[ok]   /health responds at ${SCANNER_URL}\n`);

  // 1. /metrics exposes arb_scanner_* counters/histograms.
  const metricsRes = await fetch(`${SCANNER_URL}/metrics`);
  const metricsText = await metricsRes.text();
  assert(metricsRes.ok, 'GET /metrics responds 200');
  assert(
    metricsText.includes('arb_scanner_cycles_total'),
    'GET /metrics exposes arb_scanner_cycles_total',
  );
  assert(
    metricsText.includes('arb_scanner_opportunities_published_total'),
    'GET /metrics exposes arb_scanner_opportunities_published_total',
  );

  // 2. GET /scanner/instances — config join runtime, returns { instances: [...] }.
  const inst = await jsonFetch(`${SCANNER_URL}/scanner/instances`);
  assert(inst.status === 200, 'GET /scanner/instances responds 200');
  assert(
    Array.isArray((inst.body ?? {}).instances),
    'GET /scanner/instances returns { instances: [...] }',
  );

  // 3. GET /scanner/findings — array (possibly empty without RPC).
  const find = await jsonFetch(`${SCANNER_URL}/scanner/findings?limit=10`);
  assert(find.status === 200, 'GET /scanner/findings responds 200');
  assert(Array.isArray(find.body), 'GET /scanner/findings returns an array');

  // 4. GET /scanner/status — worker runtime status.
  const status = await jsonFetch(`${SCANNER_URL}/scanner/status`);
  assert(status.status === 200, 'GET /scanner/status responds 200');
  assert(
    typeof (status.body ?? {}).isShuttingDown === 'boolean',
    'GET /scanner/status returns { isShuttingDown: boolean, ... }',
  );

  console.log(
    `\ne2e-scanner-smoke: ${process.exitCode === 1 ? 'FAIL' : 'ok'} (read-only endpoints verified; full RPC round-trip is the manual DoD in scanner-harness-runbook.md §3)`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
