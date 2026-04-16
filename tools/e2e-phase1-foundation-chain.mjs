#!/usr/bin/env node
/**
 * Phase 1 DoD (§50.3): HTTP chain intake → opportunity → risk → capital → execution (arm).
 *
 * Prerequisites: PostgreSQL migrated; services running with defaults from AGENTS.md:
 *   risk 3000, opportunity 3010, capital 3011, execution 3012, market-intake 3015
 *   (override via env vars below).
 *
 * Usage: node tools/e2e-phase1-foundation-chain.mjs
 */

import { randomUUID } from 'node:crypto';

const INTAKE_URL = (process.env.MARKET_INTAKE_SERVICE_URL ?? 'http://127.0.0.1:3015').replace(
  /\/$/,
  '',
);
const OPP_URL = (process.env.OPPORTUNITY_SERVICE_URL ?? 'http://127.0.0.1:3010').replace(/\/$/, '');
const CAPITAL_URL = (process.env.CAPITAL_SERVICE_URL ?? 'http://127.0.0.1:3011').replace(/\/$/, '');
const EXEC_URL = (process.env.EXECUTION_ORCHESTRATOR_URL ?? 'http://127.0.0.1:3012').replace(
  /\/$/,
  '',
);

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

async function main() {
  const correlationId = randomUUID();
  const venueSymbol = `E2E-${randomUUID().slice(0, 8)}`;
  const observedAt = new Date().toISOString();

  const ingest = await jsonFetch(`${INTAKE_URL}/snapshots/ingest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-correlation-id': correlationId },
    body: JSON.stringify({
      correlationId,
      venueCode: 'paper',
      venueSymbol,
      bid: 1.01,
      ask: 1.02,
      observedAt,
      staleAfterSeconds: 300,
    }),
  });
  assert(typeof ingest.entityVersion === 'number' && ingest.entityVersion >= 1, 'ingest.entityVersion');

  const oppCreate = await jsonFetch(`${OPP_URL}/opportunities`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-correlation-id': correlationId },
    body: JSON.stringify({ correlationId, payload: { venueSymbol, source: 'e2e-phase1' } }),
  });
  const opportunityId = oppCreate.id;

  await jsonFetch(`${OPP_URL}/opportunities/${opportunityId}/enrich`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-correlation-id': correlationId },
    body: JSON.stringify({ payloadPatch: { snapshotVenueSymbol: venueSymbol } }),
  });

  const riskEval = await jsonFetch(`${OPP_URL}/opportunities/${opportunityId}/request-risk-evaluation`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-correlation-id': correlationId },
    body: JSON.stringify({
      correlationId,
      notionalUsd: 10_000,
      snapshotVersion: ingest.entityVersion,
      riskMode: 'fast',
    }),
  });
  assert(typeof riskEval.riskDecisionId === 'string', 'riskDecisionId');
  assert(riskEval.state === 'risk_checked', `expected risk_checked, got ${riskEval.state}`);

  const plan = await jsonFetch(`${EXEC_URL}/execution/plans`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-correlation-id': correlationId },
    body: JSON.stringify({
      correlationId,
      riskDecisionId: riskEval.riskDecisionId,
      routeKey: `arb:e2e:venue:${venueSymbol}`,
    }),
  });
  assert(plan.state === 'planned', `plan state planned, got ${plan.state}`);
  const planId = plan.id;

  const resv = await jsonFetch(`${CAPITAL_URL}/capital/reservations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-correlation-id': correlationId },
    body: JSON.stringify({
      correlationId,
      planId,
      amountUsd: 100,
      ttlSeconds: 600,
    }),
  });
  assert(resv.state === 'active', `reservation active, got ${resv.state}`);
  const reservationId = resv.id;

  const linked = await jsonFetch(`${EXEC_URL}/execution/plans/${planId}/link-reservation`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-correlation-id': correlationId },
    body: JSON.stringify({ capitalReservationId: reservationId }),
  });
  assert(linked.state === 'reserved', `linked reserved, got ${linked.state}`);

  const armed = await jsonFetch(`${EXEC_URL}/execution/plans/${planId}/arm`, {
    method: 'POST',
    headers: { 'x-correlation-id': correlationId },
  });
  assert(armed.state === 'armed', `armed, got ${armed.state}`);

  let legFlow = null;
  if (process.env.E2E_INCLUDE_EXECUTION_LEG === 'true') {
    const begun = await jsonFetch(`${EXEC_URL}/execution/plans/${planId}/begin-execution`, {
      method: 'POST',
      headers: { 'x-correlation-id': correlationId },
    });
    assert(begun.plan.state === 'executing', `executing, got ${begun.plan.state}`);
    const legId = begun.legs[0]?.id;
    assert(typeof legId === 'string', 'leg id');
    await jsonFetch(
      `${EXEC_URL}/execution/plans/${planId}/legs/${legId}/mark-sent`,
      {
        method: 'POST',
        headers: { 'x-correlation-id': correlationId },
      },
    );
    await jsonFetch(
      `${EXEC_URL}/execution/plans/${planId}/legs/${legId}/mark-acknowledged`,
      {
        method: 'POST',
        headers: { 'x-correlation-id': correlationId },
      },
    );
    const filled = await jsonFetch(
      `${EXEC_URL}/execution/plans/${planId}/legs/${legId}/apply-fill`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-correlation-id': correlationId },
        body: JSON.stringify({
          mode: 'full',
          idempotencyKey: randomUUID(),
        }),
      },
    );
    assert(filled.state === 'filled', `leg filled, got ${filled.state}`);
    legFlow = { legId, legState: filled.state };
  }

  // eslint-disable-next-line no-console -- CLI script
  console.log(
    JSON.stringify(
      {
        ok: true,
        correlationId,
        venueSymbol,
        snapshotEntityVersion: ingest.entityVersion,
        opportunityId,
        riskDecisionId: riskEval.riskDecisionId,
        planId,
        capitalReservationId: reservationId,
        legFlow,
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  // eslint-disable-next-line no-console -- CLI script
  console.error(err);
  process.exit(1);
});
