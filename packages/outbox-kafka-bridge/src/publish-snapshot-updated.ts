import 'reflect-metadata';

import { EVENT_NAMES } from '@arbibot/contracts';
import { fetchLockedOutboxBatch, type LockedOutboxRow } from '@arbibot/messaging';
import { OutboxEventEntity } from '@arbibot/persistence';
import { Kafka, type Producer } from 'kafkajs';
import type { DataSource } from 'typeorm';

/** Event types published to Kafka by this bridge (shared topic, one row per tick). */
const KAFKA_PUBLISH_EVENT_TYPES = [
  EVENT_NAMES.snapshotUpdated,
  EVENT_NAMES.capitalReserved,
  EVENT_NAMES.planArmed,
  EVENT_NAMES.legFilled,
  EVENT_NAMES.planCompleted,
  EVENT_NAMES.dexTransactionSubmitted,
  EVENT_NAMES.dexTransactionConfirmed,
  EVENT_NAMES.dexTransactionFailed,
] as const;

export type PublishSnapshotUpdatedResult = 'published' | 'empty';

/**
 * Locks one unprocessed outbox row whose `event_type` is in
 * {@link KAFKA_PUBLISH_EVENT_TYPES}, publishes the full envelope JSON to Kafka,
 * then sets `processed_at` in the same DB transaction after the broker accepts the record.
 *
 * In-DB relays (e.g. RiskDecisionIssued → opportunity-service) filter other `event_type`
 * values and never compete for `processed_at` on these rows. `LegFilled` / `PlanCompleted`
 * are bus-only (no in-DB relay in this repo).
 */
export async function publishOneSnapshotUpdated(
  ds: DataSource,
  producer: Producer,
  topic: string,
): Promise<PublishSnapshotUpdatedResult> {
  return ds.transaction(async (em) => {
    const batch = await fetchLockedOutboxBatch(em, 1, [...KAFKA_PUBLISH_EVENT_TYPES]);
    if (batch.length === 0) {
      return 'empty';
    }
    const row = batch[0]!;
    const value = JSON.stringify(row.envelope);
    await producer.send({
      topic,
      messages: [{ key: row.messageId, value }],
    });
    await em.update(
      OutboxEventEntity,
      { id: row.id },
      { processedAt: new Date() },
    );
    return 'published';
  });
}

export async function createKafkaProducer(brokers: string[]): Promise<{
  kafka: Kafka;
  producer: Producer;
}> {
  const kafka = new Kafka({
    clientId: process.env.KAFKA_CLIENT_ID ?? 'arbibot-outbox-publisher',
    brokers,
  });
  const producer = kafka.producer();
  await producer.connect();
  return { kafka, producer };
}

export function parseBrokerList(raw: string | undefined): string[] {
  if (raw === undefined || raw.trim().length === 0) {
    return [];
  }
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export type { LockedOutboxRow };
