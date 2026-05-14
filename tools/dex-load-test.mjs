#!/usr/bin/env node
/**
 * DEX Infrastructure Load Test
 *
 * Stress-tests execution-orchestrator DEX endpoints: health, RPC, concurrent leg submissions.
 * Supports --dry-run (no real transactions, uses lab venue mock).
 *
 *   EXECUTION_API_BASE=http://127.0.0.1:3012 node tools/dex-load-test.mjs
 *   EXECUTION_API_BASE=http://127.0.0.1:3012 node tools/dex-load-test.mjs --dry-run
 *
 * Environment variables:
 *   EXECUTION_API_BASE   — execution-orchestrator base URL (required)
 *   DEX_LOAD_CONCURRENCY — max concurrent workers (default: 5, max: 50)
 *   DEX_LOAD_REQUESTS    — total requests (default: 20)
 *   DEX_LOAD_TIMEOUT_MS  — per-request timeout (default: 10000)
 *
 * Thresholds (env overrides):
 *   DEX_THRESHOLD_MAX_LATENCY_MS  — p95 latency threshold (default: 2000)
 *   DEX_THRESHOLD_MAX_ERROR_RATE  — max error rate 0..1 (default: 0.1)
 *   DEX_THRESHOLD_MIN_THROUGHPUT  — min requests/sec (default: 1)
 */

// ── Config ──────────────────────────────────────────────────────────────────

const dryRun = process.argv.includes('--dry-run');

const base = process.env.EXECUTION_API_BASE?.replace(/\/+$/, '');
if (!base) {
  console.error('dex-load-test: set EXECUTION_API_BASE (e.g. http://127.0.0.1:3012)');
  process.exit(1);
}

const concurrency = Math.min(
  50,
  Math.max(1, parseInt(process.env.DEX_LOAD_CONCURRENCY ?? '5', 10) || 5),
);
const totalRequests = Math.max(
  concurrency,
  parseInt(process.env.DEX_LOAD_REQUESTS ?? '20', 10) || 20,
);
const timeoutMs = parseInt(process.env.DEX_LOAD_TIMEOUT_MS ?? '10000', 10) || 10000;

const THRESHOLD_MAX_LATENCY_MS = parseInt(process.env.DEX_THRESHOLD_MAX_LATENCY_MS ?? '2000', 10);
const THRESHOLD_MAX_ERROR_RATE = parseFloat(process.env.DEX_THRESHOLD_MAX_ERROR_RATE ?? '0.1');
const THRESHOLD_MIN_THROUGHPUT = parseFloat(process.env.DEX_THRESHOLD_MIN_THROUGHPUT ?? '1');

// ── Helpers ─────────────────────────────────────────────────────────────────

/** @param {number[]} values @returns {{ p50: number, p95: number, p99: number, min: number, max: number, avg: number }} */
function percentiles(values) {
  if (values.length === 0) return { p50: 0, p95: 0, p99: 0, min: 0, max: 0, avg: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const p = (pct) => sorted[Math.min(Math.floor(pct * sorted.length), sorted.length - 1)];
  const avg = sorted.reduce((s, v) => s + v, 0) / sorted.length;
  return { p50: p(0.5), p95: p(0.95), p99: p(0.99), min: sorted[0], max: sorted[sorted.length - 1], avg: Math.round(avg) };
}

function fmtMs(ms) {
  return `${ms}ms`;
}

// ── Phases ──────────────────────────────────────────────────────────────────

/**
 * Phase 1: Health check warmup — hit /health/dex and /health/rpc sequentially.
 * @returns {{ dexLatency: number, rpcLatency: number }}
 */
async function phaseHealthCheck() {
  console.log('\n━━━ Phase 1: Health Check Warmup ━━━');

  let dexLatency = 0;
  let rpcLatency = 0;

  // DEX health
  try {
    const t0 = Date.now();
    const res = await fetch(`${base}/health/dex`, { signal: AbortSignal.timeout(timeoutMs) });
    dexLatency = Date.now() - t0;
    const body = await res.json();
    console.log(`  GET /health/dex → ${res.status} (${fmtMs(dexLatency)}) status=${body.status ?? 'n/a'}`);
    if (res.status >= 400) {
      console.warn('  ⚠ DEX health check returned error status');
    }
  } catch (err) {
    dexLatency = -1;
    console.warn(`  GET /health/dex → FAILED: ${err.message}`);
  }

  // RPC health
  try {
    const t0 = Date.now();
    const res = await fetch(`${base}/health/rpc`, { signal: AbortSignal.timeout(timeoutMs) });
    rpcLatency = Date.now() - t0;
    const body = await res.json();
    console.log(`  GET /health/rpc → ${res.status} (${fmtMs(rpcLatency)})`);
    if (res.status >= 400) {
      console.warn('  ⚠ RPC health check returned error status');
    }
  } catch (err) {
    rpcLatency = -1;
    console.warn(`  GET /health/rpc → FAILED: ${err.message}`);
  }

  return { dexLatency, rpcLatency };
}

/**
 * Phase 2: Concurrent leg submissions via /v1/submit-leg (same interface DEX adapters use).
 * @returns {{ latencies: number[], statuses: Map<number, number>, errors: string[] }}
 */
async function phaseConcurrentSubmit() {
  console.log(`\n━━━ Phase 2: Concurrent Submit (${totalRequests} requests, ${concurrency} workers) ━━━`);
  if (dryRun) {
    console.log('  [dry-run] Using mock payloads (no real DEX transactions)');
  }

  const latencies = [];
  const statuses = new Map();
  const errors = [];
  const queue = [];
  for (let i = 0; i < totalRequests; i++) queue.push(i);
  let done = 0;

  async function submitOne(i) {
    const body = {
      planId: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
      legId: `10000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
      legIndex: 0,
      submitIdempotencyKey: `dex-load:${i}:${Date.now()}`,
      // DEX-specific metadata (ignored by HTTP venue, used by DEX adapters)
      venueKey: dryRun ? 'http-lab' : 'uniswap-v2',
      legMetadata: dryRun ? {} : {
        chainId: 42161,
        tokenIn: '0x82aF49447D8a07e3bd95BD0d56f35241523fB691',
        tokenOut: '0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8',
        amountIn: '1000000000000000000',
      },
    };

    const t0 = Date.now();
    try {
      const res = await fetch(`${base}/v1/submit-leg`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
      const ms = Date.now() - t0;
      latencies.push(ms);
      statuses.set(res.status, (statuses.get(res.status) ?? 0) + 1);
      return { status: res.status, ms };
    } catch (err) {
      const ms = Date.now() - t0;
      latencies.push(ms);
      statuses.set(0, (statuses.get(0) ?? 0) + 1);
      errors.push(err.message);
      return { status: 0, ms };
    }
  }

  async function worker() {
    while (queue.length > 0) {
      const i = queue.shift();
      if (i === undefined) break;
      const r = await submitOne(i);
      done++;
      if (done % Math.max(1, Math.floor(totalRequests / 10)) === 0 || r.status >= 400 || r.status === 0) {
        console.log(`  ${done}/${totalRequests} status=${r.status} latency=${fmtMs(r.ms)}`);
      }
    }
  }

  const wallStart = Date.now();
  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  const wallTime = Date.now() - wallStart;

  return { latencies, statuses, errors, wallTime };
}

/**
 * Phase 3: Metrics scrape — read /metrics and look for DEX-specific metrics.
 * @returns {{ scrapeLatency: number, foundMetrics: string[] }}
 */
async function phaseMetricsScrape() {
  console.log('\n━━━ Phase 3: Metrics Scrape ━━━');

  let scrapeLatency = 0;
  const foundMetrics = [];

  try {
    const t0 = Date.now();
    const res = await fetch(`${base}/metrics`, { signal: AbortSignal.timeout(timeoutMs) });
    scrapeLatency = Date.now() - t0;
    const text = await res.text();

    const dexMetricNames = [
      'arb_dex_rpc_latency_seconds',
      'arb_dex_gas_price_gwei',
      'arb_dex_swap_total',
      'arb_dex_confirmation_seconds',
      'arb_dex_signature_seconds',
      'arb_dex_broadcast_seconds',
      'arb_rpc_latency_seconds',
      'arb_rpc_failures_total',
    ];

    for (const name of dexMetricNames) {
      if (text.includes(name)) {
        foundMetrics.push(name);
      }
    }

    console.log(`  GET /metrics → ${res.status} (${fmtMs(scrapeLatency)})`);
    console.log(`  DEX metrics found: ${foundMetrics.length}/${dexMetricNames.length}`);
    for (const m of foundMetrics) {
      console.log(`    ✓ ${m}`);
    }
    const missing = dexMetricNames.filter((m) => !foundMetrics.includes(m));
    if (missing.length > 0) {
      console.log(`  Missing metrics (expected if no DEX activity yet):`);
      for (const m of missing) {
        console.log(`    ✗ ${m}`);
      }
    }
  } catch (err) {
    scrapeLatency = -1;
    console.warn(`  GET /metrics → FAILED: ${err.message}`);
  }

  return { scrapeLatency, foundMetrics };
}

// ── Report ──────────────────────────────────────────────────────────────────

function printReport(health, submit, metrics) {
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('            DEX Load Test Report');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`  Mode:          ${dryRun ? 'DRY-RUN (no real tx)' : 'LIVE'}`);
  console.log(`  Target:        ${base}`);
  console.log(`  Concurrency:   ${concurrency}`);
  console.log(`  Total reqs:    ${totalRequests}`);

  // Health
  console.log('\n── Health Check ──');
  console.log(`  /health/dex:   ${health.dexLatency >= 0 ? fmtMs(health.dexLatency) : 'FAILED'}`);
  console.log(`  /health/rpc:   ${health.rpcLatency >= 0 ? fmtMs(health.rpcLatency) : 'FAILED'}`);

  // Submit latencies
  const stats = percentiles(submit.latencies);
  const throughput = submit.wallTime > 0 ? (submit.latencies.length / (submit.wallTime / 1000)).toFixed(1) : '0';
  const errorCount = (submit.statuses.get(0) ?? 0) + (submit.statuses.get(500) ?? 0) + (submit.statuses.get(503) ?? 0);
  const errorRate = submit.latencies.length > 0 ? errorCount / submit.latencies.length : 0;

  console.log('\n── Submit Leg Latency ──');
  console.log(`  min:    ${fmtMs(stats.min)}`);
  console.log(`  p50:    ${fmtMs(stats.p50)}`);
  console.log(`  p95:    ${fmtMs(stats.p95)}`);
  console.log(`  p99:    ${fmtMs(stats.p99)}`);
  console.log(`  max:    ${fmtMs(stats.max)}`);
  console.log(`  avg:    ${fmtMs(stats.avg)}`);
  console.log(`  wall:   ${fmtMs(submit.wallTime)}`);
  console.log(`  rps:    ${throughput}`);

  console.log('\n── Status Codes ──');
  for (const [code, count] of submit.statuses) {
    console.log(`  ${code === 0 ? 'ERROR' : code}: ${count}`);
  }

  if (submit.errors.length > 0) {
    console.log(`\n── Errors (${submit.errors.length}) ──`);
    const unique = [...new Set(submit.errors)];
    for (const e of unique.slice(0, 5)) {
      console.log(`  • ${e}`);
    }
    if (unique.length > 5) {
      console.log(`  ... and ${unique.length - 5} more`);
    }
  }

  // Metrics
  console.log('\n── Metrics Scrape ──');
  console.log(`  Scrape latency: ${metrics.scrapeLatency >= 0 ? fmtMs(metrics.scrapeLatency) : 'FAILED'}`);
  console.log(`  DEX metrics:    ${metrics.foundMetrics.length} found`);

  // Thresholds
  console.log('\n── Threshold Checks ──');
  const checks = [
    {
      name: 'p95 latency',
      value: stats.p95,
      threshold: THRESHOLD_MAX_LATENCY_MS,
      unit: 'ms',
      pass: stats.p95 <= THRESHOLD_MAX_LATENCY_MS,
    },
    {
      name: 'error rate',
      value: (errorRate * 100).toFixed(1),
      threshold: (THRESHOLD_MAX_ERROR_RATE * 100).toFixed(0),
      unit: '%',
      pass: errorRate <= THRESHOLD_MAX_ERROR_RATE,
    },
    {
      name: 'throughput',
      value: throughput,
      threshold: THRESHOLD_MIN_THROUGHPUT,
      unit: 'req/s',
      pass: parseFloat(throughput) >= THRESHOLD_MIN_THROUGHPUT,
    },
  ];

  let allPassed = true;
  for (const c of checks) {
    const icon = c.pass ? '✅' : '❌';
    console.log(`  ${icon} ${c.name}: ${c.value} ${c.unit} (threshold: ${c.threshold} ${c.unit})`);
    if (!c.pass) allPassed = false;
  }

  console.log('\n═══════════════════════════════════════════════════════════');
  if (allPassed) {
    console.log('  ✅ ALL THRESHOLDS PASSED');
  } else {
    console.log('  ❌ SOME THRESHOLDS FAILED');
  }
  console.log('═══════════════════════════════════════════════════════════\n');

  return allPassed;
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`DEX Load Test — dryRun=${dryRun} concurrency=${concurrency} total=${totalRequests}`);
  console.log(`Target: ${base}`);

  const health = await phaseHealthCheck();
  const submit = await phaseConcurrentSubmit();
  const metrics = await phaseMetricsScrape();

  const passed = printReport(health, submit, metrics);
  process.exit(passed ? 0 : 1);
}

main().catch((err) => {
  console.error('dex-load-test: fatal error', err);
  process.exit(2);
});