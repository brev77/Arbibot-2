import 'reflect-metadata';

import { OutboxEventEntity } from '@arbibot/persistence';
import { DataSource } from 'typeorm';

import {
  createKafkaProducer,
  parseBrokerList,
  publishOneSnapshotUpdated,
} from '../publish-snapshot-updated';

async function ensureTopic(kafka: import('kafkajs').Kafka, topic: string): Promise<void> {
  const admin = kafka.admin();
  await admin.connect();
  try {
    await admin.createTopics({
      topics: [{ topic, numPartitions: 1, replicationFactor: 1 }],
      waitForLeaders: true,
    });
  } finally {
    await admin.disconnect();
  }
}

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
  const pollMs = Number(process.env.OUTBOX_KAFKA_POLL_MS ?? '2000');

  const ds = new DataSource({
    type: 'postgres',
    url,
    entities: [OutboxEventEntity],
    synchronize: false,
  });
  await ds.initialize();

  const { kafka, producer } = await createKafkaProducer(brokers);
  if (process.env.KAFKA_AUTO_CREATE_TOPIC !== 'false') {
    await ensureTopic(kafka, topic);
  }

  const tick = async (): Promise<void> => {
    const result = await publishOneSnapshotUpdated(ds, producer, topic);
    if (result === 'published') {
      console.log(`[outbox-kafka-publish] published one row to ${topic}`);
    }
  };

  await tick();
  setInterval(() => {
    void tick().catch((err: unknown) => {
      console.error(err);
    });
  }, pollMs);

  await new Promise<void>(() => {
    /* long-running worker */
  });
}

void main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
