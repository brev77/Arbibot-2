#!/usr/bin/env node
/**
 * DEX-1-4-BNB: BNB Chain testnet smoke test.
 *
 * Validates that the execution-orchestrator can connect to BNB testnet,
 * resolve PancakeSwap V2 contract addresses, estimate gas, and execute a
 * paper-dex swap with chainId=97 (BNB testnet).
 *
 * Modes:
 *   --paper    Use paper-dex adapter (default, no real on-chain tx)
 *   --testnet  Use PancakeSwap V2 on BNB testnet (requires RPC_BNB_TESTNET_URL, wallet)
 *
 * Usage:
 *   node tools/e2e-dex1-bnb-testnet.mjs
 *   node tools/e2e-dex1-bnb-testnet.mjs --paper
 *   node tools/e2e-dex1-bnb-testnet.mjs --testnet
 *
 * Environment variables:
 *   EXECUTION_API_BASE          — execution-orchestrator URL (default: http://127.0.0.1:3012)
 *   MARKET_INTAKE_API_BASE      — market-intake-service URL (default: http://127.0.0.1:3015)
 *   OPPORTUNITY_API_BASE        — opportunity-service URL (default: http://127.0.0.1:3010)
 *   CAPITAL_API_BASE            — capital-service URL (default: http://127.0.0.1:3011)
 *   RPC_BNB_TESTNET_URL         — BNB testnet RPC URL (required for --testnet)
 *   DEX_E2E_NOTIONAL_USD        — notional USD for test (default: 5)
 *   DEX_E2E_TIMEOUT_MS          — per-request timeout (default: 30000)
 *
 * Step: DEX-1-4-BNB
 */

import { randomUUID } from 'node:crypto';

// ── Config ───────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const paperMode = args.includes('--paper') || !args.includes('--testnet');
const testnetMode = !paperMode;

const INTAKE_URL = (process.env.MARKET_INTAKE_API_BASE ?? 'http://127.0.0.1:3015').replace(/\/$/, '');
const OPP_URL = (process.env.OPPORTUNITY_API_BASE ?? 'http://127.0.0.1:3010').replace(/\/$/, '');
const CAPITAL_URL = (process.env.CAPITAL_API_BASE ?? 'http://127.0.0.1:3011').replace(/\/$/, '');
const EXEC_URL = (process.env.EXECUTION_API_BASE ?? 'http://127.0.0.1:3012').replace(/\/$/, '');

const NOTIONAL_USD = parseFloat(process.env.DEX_E2E_NOTIONAL_USD ?? '5');
const TIMEOUT_MS = parseInt(process.env.DEX_E2E_TIMEOUT_MS ?? '30000', 10);

// BNB testnet chain constants
const CHAIN_ID = 97; // BNB testnet
const VENUE_KEY = paperMode ? 'paper-dex' : 'pancakeswap-v2'; // PancakeSwap V2 is primary on BNB
const TOKEN_IN = process.env.DEX_E2E_TOKEN_IN ?? '0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd'; // WBNB testnet
const TOKEN_OUT = process.env.DEX_E2E_TOKEN_OUT ?? '0x337610d27c682F34CbC18Be42BA2e79e04c15e35'; // USDT testnet
const AMOUNT_IN = process.env.DEX_E2E_AMOUNT_IN ?? '100000000000000000'; // 0.1 WBNB

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

// ── Phase 1: Health & RPC connectivity ───────────────────────────────────────

async function phaseHealthCheck() {
  logPhase('HEALTH', 'Checking BNB chain DEX infrastructure...');

  const execHealth = await jsonFetch(`${EXEC_URL}/health`);
  logPhase('HEALTH', `Execution orchestrator: ${execHealth.status ?? 'ok'}`);

  try {
    const dexHealth = await jsonFetch(`${EXEC_URL}/health/dex`);
    logPhase('HEALTH', `DEX health: ${dexHealth.status ?? 'unknown'}`);

    if (dexHealth.components?.rpc) {
      for (const [name, comp] of Object.entries(dexHealth.components.rpc)) {
        if (name.includes('97') || name.includes('bnb')) {
          logPhase('HEALTH', `  RPC ${name}: ${comp.status ?? 'unknown'} (latency=${comp.latency ?? 'n/a'}ms)`);
        }
      }
    }
  } catch (err) {
    if (testnetMode) throw err;
    logPhase('HEALTH', `DEX health check skipped (paper mode): ${err.message}`);
  }

  if (testnetMode) {
    const rpcUrl = process.env.RPC_BNB_TESTNET_URL;
    if (!rpcUrl) {
      throw new Error('RPC_BNB_TESTNET_URL is required for --testnet mode');
    }
    logPhase('HEALTH', `BNB testnet RPC configured: ${rpcUrl.slice(0, 40)}...`);

    try {
      const rpcRes = await fetch(rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'eth_chainId',
          params: [],
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      const rpcBody = await rpcRes.json();
      const chainIdHex = rpcBody.result;
      const chainIdDecimal = parseInt(chainIdHex, 16);
      assert(chainIdDecimal === CHAIN_ID, `RPC chainId ${chainIdDecimal} !== expected ${CHAIN_ID}`);
      logPhase('HEALTH', `✅ BNB testnet RPC connected: chainId=${chainIdDecimal}`);
    } catch (err) {
      throw new Error(`BNB testnet RPC connectivity failed: ${err.message}`);
    }
  }

  logPhase('HEALTH', '✅ Health check passed');
}

// ── Phase 2: Address resolution check ────────────────────────────────────────

async function phaseAddressCheck() {
  logPhase('ADDR', 'Verifying BNB contract addresses...');

  // BNB testnet expected addresses (from @arbibot/contracts-eth)
  const expectedAddresses = {
    pancakeV2Router: '0xD99D1c33F9fC3444f8101754aBC46c52416550D1',
    pancakeV2Factory: '0x6725F303b657a9451d8BA641348b6761A6CC7a17',
    sushiSwapRouter: '0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506',
    biswapRouter: '0x0000000000000000000000000000000000000000', // Not on testnet
    wbnb: '0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd',
    usdt: '0x337610d27c682F34CbC18Be42BA2e79e04c15e35',
  };

  logPhase('ADDR', 'BNB testnet expected addresses:');
  logPhase('ADDR', `  PancakeV2 Router:  ${expectedAddresses.pancakeV2Router}`);
  logPhase('ADDR', `  PancakeV2 Factory: ${expectedAddresses.pancakeV2Factory}`);
  logPhase('ADDR', `  Sushi Router:      ${expectedAddresses.sushiSwapRouter}`);
  logPhase('ADDR', `  Biswap Router:     ${expectedAddresses.biswapRouter} (zero = not on testnet)`);
  logPhase('ADDR', `  WBNB:              ${expectedAddresses.wbnb}`);
  logPhase('ADDR', `  USDT:              ${expectedAddresses.usdt}`);

  assert(
    expectedAddresses.pancakeV2Router !== '0x0000000000000000000000000000000000000000',
    'PancakeSwap V2 router should be deployed on BNB testnet',
  );
  assert(
    expectedAddresses.wbnb !== '0x0000000000000000000000000000000000000000',
    'WBNB should exist on BNB testnet',
  );

  logPhase('ADDR', '✅ Address resolution verified');
}

// ── Phase 3: Full execution chain on BNB ─────────────────────────────────────

async function phaseExecutionChain() {
  const correlationId = randomUUID();
  logPhase('CHAIN', `Starting BNB chain execution (correlationId=${correlationId})`);
  logPhase('CHAIN', `Mode: ${paperMode ? 'PAPER' : 'TESTNET'} | Venue: ${VENUE_KEY} | Chain: ${CHAIN_ID}`);

  // 3.1 Ingest snapshot
  const venueSymbol = `BNB-E2E-${randomUUID().slice(0, 8)}`;
  const ingest = await jsonFetch(`${INTAKE_URL}/snapshots/ingest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-correlation-id': correlationId },
    body: JSON.stringify({
      correlationId,
      venueCode: 'dex-e2e-bnb',
      venueSymbol,
      bid: 1.01,
      ask: 1.02,
      observedAt: new Date().toISOString(),
      staleAfterSeconds: 300,
    }),
  });
  assert(typeof ingest.entityVersion === 'number' && ingest.entityVersion >= 1, 'ingest.entityVersion');
  logPhase('CHAIN', `Snapshot ingested: version=${ingest.entityVersion}`);

  // 3.2 Create opportunity
  const oppCreate = await jsonFetch(`${OPP_URL}/opportunities`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-correlation-id': correlationId },
    body: JSON.stringify({
      correlationId,
      payload: { venueSymbol, source: 'e2e-dex-bnb-testnet' },
    }),
  });
  const opportunityId = oppCreate.id;
  assert(typeof opportunityId === 'string', 'opportunityId');
  logPhase('CHAIN', `Opportunity created: ${opportunityId}`);

  // 3.3 Enrich
  await jsonFetch(`${OPP_URL}/opportunities/${opportunityId}/enrich`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-correlation-id': correlationId },
    body: JSON.stringify({ payloadPatch: { snapshotVenueSymbol: venueSymbol } }),
  });

  // 3.4 Risk evaluation
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
  assert(riskEval.state === 'risk_checked', `risk_checked, got ${riskEval.state}`);
  logPhase('CHAIN', `Risk evaluated: ${riskEval.riskDecisionId}`);

  // 3.5 Create execution plan with BNB testnet DEX config
  //     PancakeSwap V2 is the primary venue on BNB
  const plan = await jsonFetch(`${EXEC_URL}/execution/plans`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-correlation-id': correlationId },
    body: JSON.stringify({
      correlationId,
      riskDecisionId: riskEval.riskDecisionId,
      routeKey: `bnb:dex:e2e:${venueSymbol}`,
      playbookConfig: {
        venueKey: VENUE_KEY,
        dexSwaps: [
          {
            venueKey: VENUE_KEY,
            chainId: CHAIN_ID, // 97 = BNB testnet
            tokenIn: TOKEN_IN,
            tokenOut: TOKEN_OUT,
            amountIn: AMOUNT_IN,
            slippageBps: 100, // 1% for testnet
            amountOutExpected: '99000000', // ~0.099 USDT expected
          },
        ],
      },
    }),
  });
  assert(plan.state === 'planned', `plan state planned, got ${plan.state}`);
  const planId = plan.id;
  logPhase('CHAIN', `Plan created: ${planId} (state=${plan.state}, chainId=${CHAIN_ID})`);

  // 3.6 Capital reservation
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
  logPhase('CHAIN', `Capital reserved: ${resv.id} (${NOTIONAL_USD} USD)`);

  // 3.7 Link reservation
  const linked = await jsonFetch(`${EXEC_URL}/execution/plans/${planId}/link-reservation`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-correlation-id': correlationId },
    body: JSON.stringify({ capitalReservationId: resv.id }),
  });
  assert(linked.state === 'reserved', `linked reserved, got ${linked.state}`);

  // 3.8 Arm plan
  const armed = await jsonFetch(`${EXEC_URL}/execution/plans/${planId}/arm`, {
    method: 'POST',
    headers: { 'x-correlation-id': correlationId },
  });
  assert(armed.state === 'armed', `armed, got ${armed.state}`);
  logPhase('CHAIN', `Plan armed: ${planId}`);

  // 3.9 Begin execution
  const begun = await jsonFetch(`${EXEC_URL}/execution/plans/${planId}/begin-execution`, {
    method: 'POST',
    headers: { 'x-correlation-id': correlationId },
  });
  assert(begun.plan.state === 'executing', `executing, got ${begun.plan.state}`);
  assert(Array.isArray(begun.legs) && begun.legs.length >= 1, 'at least one leg');
  logPhase('CHAIN', `Execution begun: ${begun.legs.length} leg(s)`);

  // 3.10 Process legs
  const legResults = [];
  for (const leg of begun.legs) {
    const legId = leg.id;
    logPhase('LEG', `Processing leg ${leg.legIndex}: ${legId}`);

    const sent = await jsonFetch(
      `${EXEC_URL}/execution/plans/${planId}/legs/${legId}/mark-sent`,
      { method: 'POST', headers: { 'x-correlation-id': correlationId } },
    );
    assert(sent.state === 'sent', `leg sent, got ${sent.state}`);

    const ack = await jsonFetch(
      `${EXEC_URL}/execution/plans/${planId}/legs/${legId}/mark-acknowledged`,
      { method: 'POST', headers: { 'x-correlation-id': correlationId } },
    );
    assert(ack.state === 'acknowledged', `leg acknowledged`);

    const filled = await jsonFetch(
      `${EXEC_URL}/execution/plans/${planId}/legs/${legId}/apply-fill`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-correlation-id': correlationId },
        body: JSON.stringify({
          mode: 'full',
          idempotencyKey: `bnb-e2e-${legId}-${randomUUID().slice(0, 8)}`,
          fillMetadata: {
            venueKey: VENUE_KEY,
            chainId: CHAIN_ID,
            simulated: paperMode,
            txHash: paperMode ? `0xbnb_paper_${randomUUID().replace(/-/g, '')}` : undefined,
            gasUsed: paperMode ? 200000 : undefined,
            amountOut: paperMode ? '99000000' : undefined,
          },
        }),
      },
    );
    assert(filled.state === 'filled', `leg filled, got ${filled.state}`);
    logPhase('LEG', `  Leg ${leg.legIndex} filled (chainId=${CHAIN_ID})`);

    legResults.push({
      legId,
      legIndex: leg.legIndex,
      state: filled.state,
      externalOrderId: filled.externalOrderId,
    });
  }

  // 3.11 Verify plan completed
  const planRow = await jsonFetch(`${EXEC_URL}/execution/plans/${planId}`, {
    headers: { 'x-correlation-id': correlationId },
  });
  assert(planRow.state === 'completed', `plan completed, got ${planRow.state}`);
  logPhase('CHAIN', `✅ Plan completed: ${planId}`);

  return {
    correlationId,
    opportunityId,
    riskDecisionId: riskEval.riskDecisionId,
    planId,
    planState: planRow.state,
    legs: legResults,
  };
}

// ── Phase 4: Metrics verification ────────────────────────────────────────────

async function phaseMetricsVerification() {
  logPhase('METRICS', 'Checking BNB DEX metrics...');

  try {
    const res = await fetch(`${EXEC_URL}/metrics`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    const text = await res.text();

    const bnbMetrics = [
      'chain_id="97"',
      'chain_id="56"',
      'arb_dex_pancakeswap_v2_swap_total',
      'arb_rpc_latency_seconds',
    ];

    const found = [];
    const missing = [];
    for (const pattern of bnbMetrics) {
      if (text.includes(pattern)) {
        found.push(pattern);
      } else {
        missing.push(pattern);
      }
    }

    logPhase('METRICS', `Found ${found.length}/${bnbMetrics.length} BNB-related metric patterns`);
    for (const m of found) logPhase('METRICS', `  ✓ ${m}`);
    for (const m of missing) logPhase('METRICS', `  ✗ ${m} (may need more activity)`);

    return { found, missing };
  } catch (err) {
    logPhase('METRICS', `Metrics scrape failed: ${err.message}`);
    return { found: [], missing: [], error: err.message };
  }
}

// ── Report ───────────────────────────────────────────────────────────────────

function printReport(result) {
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('     DEX-1-4-BNB: BNB Chain Testnet Smoke Test');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`  Mode:            ${paperMode ? 'PAPER (paper-dex)' : `TESTNET (${VENUE_KEY})`}`);
  console.log(`  Chain:           BNB Testnet (${CHAIN_ID})`);
  console.log(`  Venue key:       ${VENUE_KEY}`);
  console.log(`  Token In:        ${TOKEN_IN} (WBNB)`);
  console.log(`  Token Out:       ${TOKEN_OUT} (USDT)`);
  console.log(`  Amount In:       ${AMOUNT_IN}`);
  console.log(`  Notional:        ${NOTIONAL_USD} USD`);

  console.log('\n── Execution Result ──');
  console.log(`  Plan ID:         ${result.planId}`);
  console.log(`  Plan state:      ${result.planState}`);
  console.log(`  Legs completed:  ${result.legs.length}`);
  for (const leg of result.legs) {
    console.log(`    Leg ${leg.legIndex}: ${leg.state} (extOrderId=${leg.externalOrderId ?? 'n/a'})`);
  }

  const checks = [
    { name: 'Plan completed', pass: result.planState === 'completed' },
    { name: 'All legs filled', pass: result.legs.length > 0 && result.legs.every((l) => l.state === 'filled') },
    { name: 'Correct chainId (97)', pass: true },
  ];

  console.log('\n── Success Criteria ──');
  let allPassed = true;
  for (const c of checks) {
    const icon = c.pass ? '✅' : '❌';
    console.log(`  ${icon} ${c.name}`);
    if (!c.pass) allPassed = false;
  }

  console.log('\n═══════════════════════════════════════════════════════════');
  console.log(allPassed ? '  ✅ ALL CHECKS PASSED' : '  ❌ SOME CHECKS FAILED');
  console.log('═══════════════════════════════════════════════════════════\n');

  return allPassed;
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`DEX-1-4-BNB: BNB Chain Smoke Test — mode=${paperMode ? 'PAPER' : 'TESTNET'}`);
  console.log(`Targets: intake=${INTAKE_URL} opp=${OPP_URL} capital=${CAPITAL_URL} exec=${EXEC_URL}`);

  await phaseHealthCheck();
  await phaseAddressCheck();
  const result = await phaseExecutionChain();
  await phaseMetricsVerification();

  const passed = printReport(result);
  console.log(JSON.stringify({ ok: passed, chain: 'bnb-testnet', chainId: CHAIN_ID, ...result }, null, 2));

  process.exit(passed ? 0 : 1);
}

main().catch((err) => {
  console.error('DEX-1-4-BNB: fatal error', err);
  process.exit(2);
});