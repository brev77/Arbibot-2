import 'reflect-metadata';

import { tryClaimInboxMessage } from '@arbibot/messaging';
import { InboxEventEntity } from '@arbibot/persistence';
import { Kafka } from 'kafkajs';
import { DataSource } from 'typeorm';

import { messageIdFromEnvelope } from '../envelope';
import { parseBrokerList } from '../publish-snapshot-updated';

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (url === undefined || url.length === 0) {
    throw new Error('DATABASE_URL is required');
  }
  const brokers = parseBrokerList(
    process.env.KAFKA_BROKERS ?? process.env.KAFKA_BOOTSTRAP_SERVERS,
  );
  if (brokers.length === 0) {
    throw new Error('KAFKA_BROKERS (or KAFKA_BOOTSTRAP_SERVERS) is required');
  }
  const topic = process.env.KAFKA_TOPIC ?? 'arbibot.domain.events';
  const groupId = process.env.KAFKA_GROUP_ID ?? 'arbibot-bus-smoke';
  const consumerId =
    process.env.KAFKA_INBOX_CONSUMER_ID ?? 'outbox-kafka-bridge-smoke';

  const ds = new DataSource({
    type: 'postgres',
    url,
    entities: [InboxEventEntity],
    synchronize: false,
  });
  await ds.initialize();

  const kafka = new Kafka({
    clientId: process.env.KAFKA_CLIENT_ID ?? 'arbibot-outbox-consumer',
    brokers,
  });
  const consumer = kafka.consumer({ groupId });
  await consumer.connect();
  await consumer.subscribe({ topic, fromBeginning: false });

  await consumer.run({
    eachMessage: async ({ message }) => {
      const raw = message.value;
      if (raw === null) {
        return;
      }
      let envelope: Record<string, unknown>;
      try {
        envelope = JSON.parse(raw.toString('utf8')) as Record<string, unknown>;
      } catch {
        console.error('[outbox-kafka-consume] invalid JSON, skipping');
        return;
      }
      const messageId = messageIdFromEnvelope(envelope);
      if (messageId === null) {
        console.error('[outbox-kafka-consume] envelope missing messageId, skipping');
        return;
      }
      const eventName =
        typeof envelope.eventName === 'string' ? envelope.eventName : '?';
      const knownBus = new Set([
        'SnapshotUpdated',
        'CapitalReserved',
        'PlanArmed',
        'LegFilled',
        'PlanCompleted',
      ]);
      if (eventName !== '?' && !knownBus.has(eventName)) {
        console.warn(
          `[outbox-kafka-consume] unexpected eventName=${eventName} (expected one of Kafka bridge allowlist)`,
        );
      }
      const entityType =
        typeof envelope.entityType === 'string' ? envelope.entityType : '';
      const entityId =
        typeof envelope.entityId === 'string' ? envelope.entityId : '';
      const correlation =
        typeof envelope.correlationId === 'string' ? envelope.correlationId : '';
      const payload =
        typeof envelope.payload === 'object' && envelope.payload !== null
          ? (envelope.payload as Record<string, unknown>)
          : null;
      let busDetail = '';
      if (
        (eventName === 'LegFilled' || eventName === 'PlanCompleted') &&
        payload !== null
      ) {
        const planId =
          typeof payload.planId === 'string' ? payload.planId : undefined;
        const legId =
          typeof payload.legId === 'string' ? payload.legId : undefined;
        if (planId) {
          busDetail = ` planId=${planId}`;
        }
        if (legId) {
          busDetail += ` legId=${legId}`;
        }
      }
      await ds.transaction(async (em) => {
        const first = await tryClaimInboxMessage(em, consumerId, messageId);
        if (first) {
          console.log(
            `[outbox-kafka-consume] claim ${messageId} event=${eventName} entityType=${entityType || '-'} entityId=${entityId || '-'} correlationId=${correlation}${busDetail}`,
          );
        }
      });
    },
  });
}

void main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
