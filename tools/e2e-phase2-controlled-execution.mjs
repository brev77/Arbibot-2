#!/usr/bin/env node
/**
 * Phase 2 slice: Phase 1 chain through `arm`, then controlled execution for all legs.
 *
 * Prerequisites: same as `e2e-phase1-foundation-chain.mjs`, plus execution-orchestrator
 * configured for the desired leg count:
 *
 * - Default (1 leg): no extra env.
 * - Multi-leg (2+): set `EXECUTION_BEGIN_LEG_COUNT` on **execution-orchestrator** before start
 *   (e.g. `EXECUTION_BEGIN_LEG_COUNT=2`).
 *
 * Optional settlement: `EXECUTION_SETTLEMENT_ENABLED=true` and reachable `portfolio-service`
 * / `capital-service` (see `.env.example`).
 *
 * Venue matrix (orchestrator env):
 * - `MOCK_VENUE_FAIL_SUBMIT_REMAINING=N` — transient rejects before success (retry `mark-sent`).
 * - `MOCK_VENUE_TERMINAL_LEG_INDEX` + `MOCK_VENUE_TERMINAL_STATE=rejected|timed_out|failed` —
 *   terminal outcome for that leg index (non-retryable).
 *
 * Usage: node tools/e2e-phase2-controlled-execution.mjs
 *
 * CI: Postgres + services + this script — `npm run ci:e2e-phase2` ([`ci-e2e-phase2.sh`](./ci-e2e-phase2.sh)), GitHub Actions job `e2e-phase2`.
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

async function phase1ThroughArm(correlationId) {
  const venueSymbol = `E2E-P2-${randomUUID().slice(0, 8)}`;
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
    body: JSON.stringify({ correlationId, payload: { venueSymbol, source: 'e2e-phase2' } }),
  });
  const opportunityId = oppCreate.id;

  await jsonFetch(`${OPP_URL}/opportunities/${opportunityId}/enrich`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-correlation-id': correlationId },
    body: JSON.stringify({ payloadPatch: { snapshotVenueSymbol: venueSymbol } }),
  });

  const riskEval = await jsonFetch(
    `${OPP_URL}/opportunities/${opportunityId}/request-risk-evaluation`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-correlation-id': correlationId },
      body: JSON.stringify({
        correlationId,
        notionalUsd: 10_000,
        snapshotVersion: ingest.entityVersion,
        riskMode: 'fast',
      }),
    },
  );
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

  return { planId, reservationId, venueSymbol, riskDecisionId: riskEval.riskDecisionId };
}

async function main() {
  const correlationId = randomUUID();
  const { planId, reservationId, venueSymbol, riskDecisionId } =
    await phase1ThroughArm(correlationId);

  const begun = await jsonFetch(`${EXEC_URL}/execution/plans/${planId}/begin-execution`, {
    method: 'POST',
    headers: { 'x-correlation-id': correlationId },
  });
  assert(begun.plan.state === 'executing', `executing, got ${begun.plan.state}`);
  assert(Array.isArray(begun.legs) && begun.legs.length >= 1, 'at least one leg');

  const listed = await jsonFetch(`${EXEC_URL}/execution/plans/${planId}/legs`, {
    headers: { 'x-correlation-id': correlationId },
  });
  const items = listed.items ?? [];
  assert(items.length === begun.legs.length, 'list legs count matches begin-execution');
  items.sort((a, b) => a.legIndex - b.legIndex);

  for (const leg of items) {
    const legId = leg.id;
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
        if (!transient || attempt === 5) {
          throw e;
        }
        await new Promise((r) => setTimeout(r, 120));
      }
    }
    assert(sent.state === 'sent', `leg ${leg.legIndex} sent, got ${sent.state}`);

    const ack = await jsonFetch(
      `${EXEC_URL}/execution/plans/${planId}/legs/${legId}/mark-acknowledged`,
      {
        method: 'POST',
        headers: { 'x-correlation-id': correlationId },
      },
    );
    assert(ack.state === 'acknowledged', `leg ${leg.legIndex} ack`);

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
    assert(filled.state === 'filled', `leg ${leg.legIndex} filled`);
  }

  const planRow = await jsonFetch(`${EXEC_URL}/execution/plans/${planId}`, {
    headers: { 'x-correlation-id': correlationId },
  });
  assert(
    planRow.state === 'completed',
    `plan completed after all legs filled, got ${planRow.state}`,
  );

  // eslint-disable-next-line no-console -- CLI script
  console.log(
    JSON.stringify(
      {
        ok: true,
        correlationId,
        venueSymbol,
        riskDecisionId,
        planId,
        capitalReservationId: reservationId,
        legCount: items.length,
        planState: planRow.state,
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
