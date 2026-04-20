#!/usr/bin/env node
/**
 * Inserts unprocessed outbox rows for `outbox-kafka-bridge` publish smoke.
 * Requires DATABASE_URL. Each row gets a new message_id.
 *
 *   npm run seed:outbox-smoke-events
 *   npm run seed:outbox-smoke-events:all
 *
 * Or: node tools/seed-outbox-events.mjs SnapshotUpdated
 */
import { randomUUID } from 'node:crypto';

import pg from 'pg';

const EVENT_NAMES = {
  snapshotUpdated: 'SnapshotUpdated',
  capitalReserved: 'CapitalReserved',
  planArmed: 'PlanArmed',
  legFilled: 'LegFilled',
  planCompleted: 'PlanCompleted',
};

const BRIDGE_TYPES = new Set(Object.values(EVENT_NAMES));

const url = process.env.DATABASE_URL;
if (url === undefined || url.length === 0) {
  console.error('seed-outbox-events: DATABASE_URL is required');
  process.exit(1);
}

function makeRow(eventName, entityType, entityId, schemaVersion, payload) {
  const messageId = randomUUID();
  const correlationId = randomUUID();
  const envelope = {
    messageId,
    correlationId,
    entityType,
    entityId,
    version: schemaVersion,
    sourceModule: 'seed-outbox-events',
    eventTs: new Date().toISOString(),
    eventName,
    payload,
  };
  return {
    messageId,
    eventName,
    entityType,
    entityId,
    schemaVersion,
    payload,
    envelope,
  };
}

function rowSnapshotUpdated() {
  const snapshotId = randomUUID();
  const payload = {
    snapshotId,
    venueCode: 'smoke',
    venueSymbol: 'TEST',
    observedAt: new Date().toISOString(),
    receivedAt: new Date().toISOString(),
    entityVersion: 1,
    staleAfterSeconds: null,
    payload: { seeded: true },
  };
  return makeRow(
    EVENT_NAMES.snapshotUpdated,
    'MarketSnapshot',
    snapshotId,
    2,
    payload,
  );
}

function rowCapitalReserved() {
  const reservationId = randomUUID();
  const planId = randomUUID();
  const correlationId = randomUUID();
  const payload = {
    reservationId,
    correlationId,
    planId,
    amountUsd: 1,
    expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    entityVersion: 1,
  };
  return makeRow(
    EVENT_NAMES.capitalReserved,
    'CapitalReservation',
    reservationId,
    1,
    payload,
  );
}

function rowPlanArmed() {
  const planId = randomUUID();
  const capitalReservationId = randomUUID();
  const payload = {
    planId,
    state: 'armed',
    capitalReservationId,
    riskDecisionId: null,
    entityVersion: 1,
  };
  return makeRow(EVENT_NAMES.planArmed, 'ExecutionPlan', planId, 1, payload);
}

function rowLegFilled() {
  const legId = randomUUID();
  const planId = randomUUID();
  const payload = {
    legId,
    planId,
    state: 'filled',
    filledQuantity: 1,
    entityVersion: 1,
  };
  return makeRow(EVENT_NAMES.legFilled, 'ExecutionLeg', legId, 1, payload);
}

function rowPlanCompleted() {
  const planId = randomUUID();
  const payload = {
    planId,
    state: 'completed',
    entityVersion: 2,
    capitalReservationId: null,
  };
  return makeRow(
    EVENT_NAMES.planCompleted,
    'ExecutionPlan',
    planId,
    1,
    payload,
  );
}

const factories = {
  [EVENT_NAMES.snapshotUpdated]: rowSnapshotUpdated,
  [EVENT_NAMES.capitalReserved]: rowCapitalReserved,
  [EVENT_NAMES.planArmed]: rowPlanArmed,
  [EVENT_NAMES.legFilled]: rowLegFilled,
  [EVENT_NAMES.planCompleted]: rowPlanCompleted,
};

function parseArgs() {
  const raw = process.argv[2]?.trim();
  if (!raw || raw === 'all') {
    return Object.keys(factories);
  }
  if (!BRIDGE_TYPES.has(raw)) {
    console.error(
      `Unknown event type "${raw}". Use one of: ${[...BRIDGE_TYPES].join(', ')} or "all".`,
    );
    process.exit(1);
  }
  return [raw];
}

const types = parseArgs();
const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  for (const eventName of types) {
    const factory = factories[eventName];
    if (!factory) continue;
    const row = factory();
    await client.query(
      `INSERT INTO outbox_events (
      message_id, event_type, entity_type, entity_id, schema_version, payload, envelope, processed_at
    ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, NULL)`,
      [
        row.messageId,
        row.eventName,
        row.entityType,
        row.entityId,
        row.schemaVersion,
        JSON.stringify(row.payload),
        JSON.stringify(row.envelope),
      ],
    );
    console.log(
      `seed-outbox-events: inserted message_id=${row.messageId} event_type=${row.eventName}`,
    );
  }
} finally {
  await client.end();
}
