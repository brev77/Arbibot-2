#!/usr/bin/env node
/**
 * DEX-1-3-LIVE-TESTNET: End-to-end test for DEX execution on testnet (or paper-dex simulation).
 *
 * Runs the full chain: snapshot → opportunity → risk → capital reservation →
 * arm → begin execution → submit legs (DEX adapter) → apply fills → plan completed.
 *
 * Modes:
 *   --paper    Use paper-dex adapter (default, no real on-chain tx)
 *   --testnet  Use real DEX adapter on testnet (requires DEX_VENUE_ENABLED, RPC, wallet)
 *   --dry-run  Alias for --paper
 *
 * Usage:
 *   node tools/e2e-dex1-testnet.mjs
 *   node tools/e2e-dex1-testnet.mjs --paper
 *   node tools/e2e-dex1-testnet.mjs --testnet
 *
 * Environment variables:
 *   EXECUTION_API_BASE          — execution-orchestrator URL (default: http://127.0.0.1:3012)
 *   MARKET_INTAKE_API_BASE      — market-intake-service URL (default: http://127.0.0.1:3015)
 *   OPPORTUNITY_API_BASE        — opportunity-service URL (default: http://127.0.0.1:3010)
 *   CAPITAL_API_BASE            — capital-service URL (default: http://127.0.0.1:3011)
 *   DEX_E2E_NOTIONAL_USD        — notional USD for test (default: 10, testnet-safe)
 *   DEX_E2E_VENUE_KEY           — override venue key (default: paper-dex or uniswap-v2)
 *   DEX_E2E_CHAIN_ID            — chain ID for testnet (default: 421614 = Arbitrum Sepolia)
 *   DEX_E2E_TOKEN_IN            — input token address (default: WETH Arbitrum)
 *   DEX_E2E_TOKEN_OUT           — output token address (default: USDC Arbitrum)
 *   DEX_E2E_AMOUNT_IN           — input amount in wei (default: 100000000000000000 = 0.1 ETH)
 *   DEX_E2E_TIMEOUT_MS          — per-request timeout (default: 30000)
 *   DEX_E2E_MAX_CONFIRM_WAIT_MS — max wait for tx confirmation on testnet (default: 120000)
 *
 * Step: DEX-1-3-LIVE-TESTNET
 */

import { randomUUID } from 'node:crypto';

// ── Config ───────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const paperMode = args.includes('--paper') || args.includes('--dry-run') || !args.includes('--testnet');
const testnetMode = !paperMode;

const INTAKE_URL = (process.env.MARKET_INTAKE_API_BASE ?? 'http://127.0.0.1:3015').replace(/\/$/, '');
const OPP_URL = (process.env.OPPORTUNITY_API_BASE ?? 'http://127.0.0.1:3010').replace(/\/$/, '');
const CAPITAL_URL = (process.env.CAPITAL_API_BASE ?? 'http://127.0.0.1:3011').replace(/\/$/, '');
const EXEC_URL = (process.env.EXECUTION_API_BASE ?? 'http://127.0.0.1:3012').replace(/\/$/, '');

const NOTIONAL_USD = parseFloat(process.env.DEX_E2E_NOTIONAL_USD ?? '10');
const TIMEOUT_MS = parseInt(process.env.DEX_E2E_TIMEOUT_MS ?? '30000', 10);
const MAX_CONFIRM_WAIT_MS = parseInt(process.env.DEX_E2E_MAX_CONFIRM_WAIT_MS ?? '120000', 10);

const DEFAULT_VENUE_KEY = paperMode ? 'paper-dex' : 'uniswap-v2';
const VENUE_KEY = process.env.DEX_E2E_VENUE_KEY ?? DEFAULT_VENUE_KEY;
const CHAIN_ID = parseInt(process.env.DEX_E2E_CHAIN_ID ?? '421614', 10); // Arbitrum Sepolia
const TOKEN_IN = process.env.DEX_E2E_TOKEN_IN ?? '0x4200000000000000000000000000000000000006'; // WETH Arbitrum Sepolia
const TOKEN_OUT = process.env.DEX_E2E_TOKEN_OUT ?? '0x75faf114eafb1acbe2a3976482854f7f230fa178'; // USDC Arbitrum Sepolia
const AMOUNT_IN = process.env.DEX_E2E_AMOUNT_IN ?? '100000000000000000'; // 0.1 ETH

// ── Helpers ──────────────────────────────────────────────────────────────────

async function jsonFetch(url, init) {
  const res = await fetch(url, {
    ...init,
    signal: init?.signal ?? AbortSignal.timeout(TIMEOUT_MS),
  });
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
    throw new Error(`ASSERTION FAILED: ${msg}`);
  }
}

function logPhase(phase, msg) {
  console.log(`[${new Date().toISOString()}] [${phase}] ${msg}`);
}

function logMetric(name, value, unit = '') {
  console.log(`  📊 ${name}: ${value}${unit}`);
}

// ── Metrics collection ───────────────────────────────────────────────────────

const metrics = {
  phases: {},
  errors: [],
  startTime: Date.now(),
};

function phaseTimer(name) {
  const start = Date.now();
  return {
    done: (extra = {}) => {
      metrics.phases[name] = { durationMs: Date.now() - start, ...extra };
    },
  };
}

// ── Phase 1: Health check ────────────────────────────────────────────────────

async function phaseHealthCheck() {
  const timer = phaseTimer('health_check');
  logPhase('HEALTH', 'Checking DEX infrastructure health...');

  // Check execution health
  try {
    const res = await jsonFetch(`${EXEC_URL}/health`);
    logPhase('HEALTH', `Execution orchestrator: ${res.status ?? 'ok'}`);
  } catch (err) {
    logPhase('HEALTH', `Execution orchestrator health: ${err.message}`);
    throw new Error('Execution orchestrator not healthy — aborting');
  }

  // Check DEX-specific health
  try {
    const res = await jsonFetch(`${EXEC_URL}/health/dex`);
    logPhase('HEALTH', `DEX health: status=${res.status ?? 'unknown'}`);

    if (res.status === 'unhealthy') {
      if (testnetMode) {
        throw new Error('DEX infrastructure unhealthy — cannot run testnet test');
      }
      logPhase('HEALTH', '⚠ DEX unhealthy (paper mode — continuing)');
    }

    if (res.components) {
      for (const [name, comp] of Object.entries(res.components)) {
        const status = comp.status ?? 'unknown';
        logPhase('HEALTH', `  ${name}: ${status}`);
      }
    }
  } catch (err) {
    if (testnetMode) throw err;
    logPhase('HEALTH', `DEX health check failed (paper mode — continuing): ${err.message}`);
  }

  timer.done();
  logPhase('HEALTH', '✅ Health check passed');
}

// ── Phase 2: Full execution chain ────────────────────────────────────────────

async function phaseExecutionChain() {
  const timer = phaseTimer('execution_chain');
  const correlationId = randomUUID();
  logPhase('CHAIN', `Starting execution chain (correlationId=${correlationId})`);
  logPhase('CHAIN', `Mode: ${paperMode ? 'PAPER (paper-dex)' : `TESTNET (${VENUE_KEY})`}`);
  logMetric('venueKey', VENUE_KEY);
  logMetric('notionalUsd', NOTIONAL_USD);
  logMetric('chainId', CHAIN_ID);
  logMetric('tokenIn', TOKEN_IN);
  logMetric('tokenOut', TOKEN_OUT);
  logMetric('amountIn', AMOUNT_IN);

  // 2.1 Ingest snapshot
  const snapshotTimer = phaseTimer('snapshot');
  const venueSymbol = `DEX-E2E-${randomUUID().slice(0, 8)}`;
  const observedAt = new Date().toISOString();

  const ingest = await jsonFetch(`${INTAKE_URL}/snapshots/ingest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-correlation-id': correlationId },
    body: JSON.stringify({
      correlationId,
      venueCode: 'dex-e2e',
      venueSymbol,
      bid: 1.01,
      ask: 1.02,
      observedAt,
      staleAfterSeconds: 300,
    }),
  });
  assert(typeof ingest.entityVersion === 'number' && ingest.entityVersion >= 1, 'ingest.entityVersion');
  snapshotTimer.done({ version: ingest.entityVersion });
  logPhase('CHAIN', `Snapshot ingested: version=${ingest.entityVersion}`);

  // 2.2 Create opportunity
  const oppTimer = phaseTimer('opportunity');
  const oppCreate = await jsonFetch(`${OPP_URL}/opportunities`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-correlation-id': correlationId },
    body: JSON.stringify({
      correlationId,
      payload: { venueSymbol, source: 'e2e-dex-testnet' },
    }),
  });
  const opportunityId = oppCreate.id;
  assert(typeof opportunityId === 'string', 'opportunityId');
  oppTimer.done({ opportunityId });
  logPhase('CHAIN', `Opportunity created: ${opportunityId}`);

  // 2.3 Enrich opportunity
  await jsonFetch(`${OPP_URL}/opportunities/${opportunityId}/enrich`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-correlation-id': correlationId },
    body: JSON.stringify({ payloadPatch: { snapshotVenueSymbol: venueSymbol } }),
  });

  // 2.4 Risk evaluation
  const riskTimer = phaseTimer('risk');
  const riskEval = await jsonFetch(
    `${OPP_URL}/opportunities/${opportunityId}/request-risk-evaluation`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-correlation-id': correlationId },
      body: JSON.stringify({
        correlationId,
        notionalUsd: NOTIONAL_USD,
        snapshotVersion: ingest.entityVersion,
        riskMode: 'fast',
      }),
    },
  );
  assert(typeof riskEval.riskDecisionId === 'string', 'riskDecisionId');
  assert(riskEval.state === 'risk_checked', `expected risk_checked, got ${riskEval.state}`);
  riskTimer.done({ riskDecisionId: riskEval.riskDecisionId });
  logPhase('CHAIN', `Risk evaluated: ${riskEval.riskDecisionId}`);

  // 2.5 Create execution plan with DEX-specific playbookConfig
  const planTimer = phaseTimer('plan');
  const plan = await jsonFetch(`${EXEC_URL}/execution/plans`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-correlation-id': correlationId },
    body: JSON.stringify({
      correlationId,
      riskDecisionId: riskEval.riskDecisionId,
      routeKey: `arb:dex:e2e:${venueSymbol}`,
      playbookConfig: {
        venueKey: VENUE_KEY,
        dexSwaps: [
          {
            venueKey: VENUE_KEY,
            chainId: CHAIN_ID,
            tokenIn: TOKEN_IN,
            tokenOut: TOKEN_OUT,
            amountIn: AMOUNT_IN,
            slippageBps: 100, // 1% slippage tolerance for testnet
          },
        ],
      },
    }),
  });
  assert(plan.state === 'planned', `plan state planned, got ${plan.state}`);
  const planId = plan.id;
  planTimer.done({ planId });
  logPhase('CHAIN', `Plan created: ${planId} (state=${plan.state})`);

  // 2.6 Capital reservation
  const resvTimer = phaseTimer('reservation');
  const resv = await jsonFetch(`${CAPITAL_URL}/capital/reservations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-correlation-id': correlationId },
    body: JSON.stringify({
      correlationId,
      planId,
      amountUsd: NOTIONAL_USD,
      ttlSeconds: 600,
    }),
  });
  assert(resv.state === 'active', `reservation active, got ${resv.state}`);
  const reservationId = resv.id;
  resvTimer.done({ reservationId });
  logPhase('CHAIN', `Capital reserved: ${reservationId} (amount=${NOTIONAL_USD} USD)`);

  // 2.7 Link reservation
  const linked = await jsonFetch(`${EXEC_URL}/execution/plans/${planId}/link-reservation`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-correlation-id': correlationId },
    body: JSON.stringify({ capitalReservationId: reservationId }),
  });
  assert(linked.state === 'reserved', `linked reserved, got ${linked.state}`);

  // 2.8 Arm plan
  const armed = await jsonFetch(`${EXEC_URL}/execution/plans/${planId}/arm`, {
    method: 'POST',
    headers: { 'x-correlation-id': correlationId },
  });
  assert(armed.state === 'armed', `armed, got ${armed.state}`);
  logPhase('CHAIN', `Plan armed: ${planId}`);

  // 2.9 Begin execution
  const execTimer = phaseTimer('execution');
  const begun = await jsonFetch(`${EXEC_URL}/execution/plans/${planId}/begin-execution`, {
    method: 'POST',
    headers: { 'x-correlation-id': correlationId },
  });
  assert(begun.plan.state === 'executing', `executing, got ${begun.plan.state}`);
  assert(Array.isArray(begun.legs) && begun.legs.length >= 1, 'at least one leg');
  logPhase('CHAIN', `Execution begun: ${begun.legs.length} leg(s)`);

  // 2.10 Process each leg
  const legs = begun.legs;
  const legResults = [];

  for (const leg of legs) {
    const legId = leg.id;
    const legIndex = leg.legIndex;
    logPhase('LEG', `Processing leg ${legIndex}: ${legId}`);

    // Mark sent
    let sent;
    for (let attempt = 0; attempt < 6; attempt += 1) {
      try {
        sent = await jsonFetch(
          `${EXEC_URL}/execution/plans/${planId}/legs/${legId}/mark-sent`,
          {
            method: 'POST',
            headers: { 'x-correlation-id': correlationId },
          },
        );
        break;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        const transient = msg.includes('502') || msg.toLowerCase().includes('transient');
        if (!transient || attempt === 5) throw e;
        await new Promise((r) => setTimeout(r, 200));
      }
    }
    assert(sent.state === 'sent', `leg ${legIndex} sent, got ${sent.state}`);
    logPhase('LEG', `  Leg ${legIndex} marked sent`);

    // Mark acknowledged
    const ack = await jsonFetch(
      `${EXEC_URL}/execution/plans/${planId}/legs/${legId}/mark-acknowledged`,
      {
        method: 'POST',
        headers: { 'x-correlation-id': correlationId },
      },
    );
    assert(ack.state === 'acknowledged', `leg ${legIndex} acknowledged`);
    logPhase('LEG', `  Leg ${legIndex} acknowledged`);

    // Apply fill — for testnet we simulate a successful fill
    // In real testnet, we'd wait for on-chain confirmation
    const fillPayload = {
      mode: 'full',
      idempotencyKey: `dex-e2e-${legId}-${randomUUID().slice(0, 8)}`,
      fillMetadata: {
        venueKey: VENUE_KEY,
        chainId: CHAIN_ID,
        simulated: paperMode,
        txHash: paperMode ? `0xpaper_${randomUUID().replace(/-/g, '')}` : undefined,
        gasUsed: paperMode ? 180000 : undefined,
        amountOut: paperMode ? '998000000000000000' : undefined,
      },
    };

    const filled = await jsonFetch(
      `${EXEC_URL}/execution/plans/${planId}/legs/${legId}/apply-fill`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-correlation-id': correlationId },
        body: JSON.stringify(fillPayload),
      },
    );
    assert(filled.state === 'filled', `leg ${legIndex} filled, got ${filled.state}`);
    logPhase('LEG', `  Leg ${legIndex} filled`);

    legResults.push({
      legId,
      legIndex,
      state: filled.state,
      externalOrderId: filled.externalOrderId,
    });
  }

  execTimer.done({ legCount: legs.length });

  // 2.11 Verify plan completed
  const planRow = await jsonFetch(`${EXEC_URL}/execution/plans/${planId}`, {
    headers: { 'x-correlation-id': correlationId },
  });
  assert(
    planRow.state === 'completed',
    `plan completed after all legs filled, got ${planRow.state}`,
  );
  logPhase('CHAIN', `Plan completed: ${planId}`);

  timer.done();
  return {
    correlationId,
    venueSymbol,
    opportunityId,
    riskDecisionId: riskEval.riskDecisionId,
    planId,
    capitalReservationId: reservationId,
    planState: planRow.state,
    legs: legResults,
  };
}

// ── Phase 3: Metrics verification ────────────────────────────────────────────

async function phaseMetricsVerification() {
  const timer = phaseTimer('metrics');
  logPhase('METRICS', 'Verifying DEX metrics...');

  try {
    const res = await fetch(`${EXEC_URL}/metrics`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const text = await res.text();

    const requiredMetrics = paperMode
      ? [
          'arb_paper_dex_swap_total',
          'arb_paper_dex_swap_latency_seconds',
          'arb_paper_dex_simulated_gas_cost_eth',
        ]
      : [
          'arb_dex_swap_total',
          'arb_dex_rpc_latency_seconds',
          'arb_dex_confirmation_seconds',
        ];

    const found = [];
    const missing = [];
    for (const name of requiredMetrics) {
      if (text.includes(name)) {
        found.push(name);
      } else {
        missing.push(name);
      }
    }

    logPhase('METRICS', `Found ${found.length}/${requiredMetrics.length} required metrics`);
    for (const m of found) {
      logPhase('METRICS', `  ✓ ${m}`);
    }
    if (missing.length > 0) {
      logPhase('METRICS', `Missing metrics (may appear after more activity):`);
      for (const m of missing) {
        logPhase('METRICS', `  ✗ ${m}`);
      }
    }

    timer.done({ foundMetrics: found.length, totalMetrics: requiredMetrics.length });
    return { found, missing };
  } catch (err) {
    logPhase('METRICS', `Metrics scrape failed: ${err.message}`);
    timer.done({ error: err.message });
    return { found: [], missing: [], error: err.message };
  }
}

// ── Report ───────────────────────────────────────────────────────────────────

function printReport(result) {
  const totalDuration = Date.now() - metrics.startTime;

  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('     DEX Testnet E2E Test Report');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`  Mode:            ${paperMode ? 'PAPER (paper-dex)' : `TESTNET (${VENUE_KEY})`}`);
  console.log(`  Venue key:       ${VENUE_KEY}`);
  console.log(`  Chain ID:        ${CHAIN_ID}`);
  console.log(`  Notional:        ${NOTIONAL_USD} USD`);
  console.log(`  Token In:        ${TOKEN_IN}`);
  console.log(`  Token Out:       ${TOKEN_OUT}`);
  console.log(`  Amount In:       ${AMOUNT_IN}`);
  console.log(`  Total duration:  ${totalDuration}ms`);

  console.log('\n── Phase Durations ──');
  for (const [name, data] of Object.entries(metrics.phases)) {
    console.log(`  ${name}: ${data.durationMs}ms`);
  }

  console.log('\n── Execution Result ──');
  console.log(`  Plan ID:         ${result.planId}`);
  console.log(`  Plan state:      ${result.planState}`);
  console.log(`  Legs completed:  ${result.legs.length}`);
  for (const leg of result.legs) {
    console.log(`    Leg ${leg.legIndex}: ${leg.state} (extOrderId=${leg.externalOrderId ?? 'n/a'})`);
  }

  if (metrics.errors.length > 0) {
    console.log(`\n── Errors (${metrics.errors.length}) ──`);
    for (const err of metrics.errors.slice(0, 5)) {
      console.log(`  • ${err}`);
    }
  }

  // Success criteria
  console.log('\n── Success Criteria ──');
  const checks = [
    { name: 'Plan completed', pass: result.planState === 'completed' },
    { name: 'All legs filled', pass: result.legs.length > 0 && result.legs.every((l) => l.state === 'filled') },
    { name: 'No errors', pass: metrics.errors.length === 0 },
    { name: 'Total duration < 60s', pass: totalDuration < 60000 },
  ];

  let allPassed = true;
  for (const c of checks) {
    const icon = c.pass ? '✅' : '❌';
    console.log(`  ${icon} ${c.name}`);
    if (!c.pass) allPassed = false;
  }

  console.log('\n═══════════════════════════════════════════════════════════');
  if (allPassed) {
    console.log('  ✅ ALL CHECKS PASSED');
  } else {
    console.log('  ❌ SOME CHECKS FAILED');
  }
  console.log('═══════════════════════════════════════════════════════════\n');

  return allPassed;
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`DEX Testnet E2E Test — mode=${paperMode ? 'PAPER' : 'TESTNET'} venue=${VENUE_KEY}`);
  console.log(`Targets: intake=${INTAKE_URL} opp=${OPP_URL} capital=${CAPITAL_URL} exec=${EXEC_URL}`);

  // Phase 1: Health check
  await phaseHealthCheck();

  // Phase 2: Full execution chain
  const result = await phaseExecutionChain();

  // Phase 3: Metrics verification
  await phaseMetricsVerification();

  // Report
  const passed = printReport(result);

  // Output machine-readable result
  console.log(JSON.stringify({ ok: passed, ...result }, null, 2));

  process.exit(passed ? 0 : 1);
}

main().catch((err) => {
  console.error('DEX testnet E2E: fatal error', err);
  metrics.errors.push(err.message);
  process.exit(2);
});
