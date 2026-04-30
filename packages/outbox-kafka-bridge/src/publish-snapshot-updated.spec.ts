import { EVENT_NAMES } from '@arbibot/contracts';
import { fetchLockedOutboxBatch } from '@arbibot/messaging';
import { OutboxEventEntity } from '@arbibot/persistence';
import type { DataSource } from 'typeorm';

import { publishOneSnapshotUpdated } from './publish-snapshot-updated';

jest.mock('@arbibot/messaging', () => ({
  fetchLockedOutboxBatch: jest.fn(),
}));

const mockFetch = jest.mocked(fetchLockedOutboxBatch);

function makeRow(
  eventType: string,
  messageId: string,
) {
  return {
    id: '10',
    messageId,
    eventType,
    entityType: 'test',
    entityId: '550e8400-e29b-41d4-a716-446655440001',
    schemaVersion: 1,
    payload: {},
    envelope: {
      messageId,
      eventName: eventType,
      correlationId: '550e8400-e29b-41d4-a716-446655440000',
    },
    createdAt: new Date(),
    processedAt: null,
    relayDeliveryAttempts: 0,
  };
}

describe('publishOneSnapshotUpdated', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('returns empty when batch has no rows', async () => {
    mockFetch.mockResolvedValue([]);
    const send = jest.fn().mockResolvedValue(undefined);
    const em = { update: jest.fn() };
    const ds = {
      transaction: jest.fn(async (fn: (x: typeof em) => Promise<'published' | 'empty'>) =>
        fn(em),
      ),
    } as unknown as DataSource;

    const result = await publishOneSnapshotUpdated(
      ds,
      { send } as never,
      'arbibot.domain.events',
    );

    expect(result).toBe('empty');
    expect(send).not.toHaveBeenCalled();
  });

  it('publishes CapitalReserved and marks outbox processed', async () => {
    const row = makeRow(EVENT_NAMES.capitalReserved, '660e8400-e29b-41d4-a716-446655440000');
    mockFetch.mockResolvedValue([row]);
    const send = jest.fn().mockResolvedValue(undefined);
    const update = jest.fn().mockResolvedValue(undefined);
    const em = { update };
    const ds = {
      transaction: jest.fn(async (fn: (x: typeof em) => Promise<'published' | 'empty'>) =>
        fn(em),
      ),
    } as unknown as DataSource;

    const result = await publishOneSnapshotUpdated(
      ds,
      { send } as never,
      'arbibot.domain.events',
    );

    expect(result).toBe('published');
    expect(send).toHaveBeenCalledWith({
      topic: 'arbibot.domain.events',
      messages: [
        {
          key: row.messageId,
          value: JSON.stringify(row.envelope),
        },
      ],
    });
    expect(update).toHaveBeenCalledWith(
      OutboxEventEntity,
      { id: row.id },
      expect.objectContaining({ processedAt: expect.any(Date) }),
    );
  });

  it('passes all Kafka publish event types to fetchLockedOutboxBatch', async () => {
    mockFetch.mockResolvedValue([]);
    const em = { update: jest.fn() };
    const ds = {
      transaction: jest.fn(async (fn: (x: typeof em) => Promise<'published' | 'empty'>) =>
        fn(em),
      ),
    } as unknown as DataSource;

    await publishOneSnapshotUpdated(ds, { send: jest.fn() } as never, 't');

    expect(mockFetch).toHaveBeenCalledWith(
      em,
      1,
      expect.arrayContaining([
        EVENT_NAMES.snapshotUpdated,
        EVENT_NAMES.capitalReserved,
        EVENT_NAMES.planArmed,
        EVENT_NAMES.legFilled,
        EVENT_NAMES.planCompleted,
      ]),
    );
  });
});
