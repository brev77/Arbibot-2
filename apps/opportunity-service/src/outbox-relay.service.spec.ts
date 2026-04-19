import { QueryFailedError } from 'typeorm';
import type {
  ArbitrageOpportunityEntity,
  InboxEventEntity,
  OutboxEventEntity,
} from '@arbibot/persistence';
import type { DataSource, EntityManager } from 'typeorm';

import type { PaperClientService } from './opportunities/paper-client.service';
import { OutboxRelayService } from './outbox-relay.service';

describe('OutboxRelayService', () => {
  let rows: Array<
    OutboxEventEntity & {
      payload: Record<string, unknown>;
      relayDeliveryAttempts: number;
      relayDeadLetterAt: Date | null;
      relayDeadLetterReason: string | null;
      processedAt: Date | null;
      paperEnqueueIdempotencyKey?: string | null;
    }
  >;
  let opportunities: ArbitrageOpportunityEntity[];
  let inbox: InboxEventEntity[];
  let service: OutboxRelayService;
  let paperClient: { enqueuePromotionCandidate: jest.Mock };
  let dataSource: DataSource;

  beforeEach(() => {
    rows = [];
    opportunities = [];
    inbox = [];
    process.env.OUTBOX_RELAY_MAX_OPPORTUNITY_ATTEMPTS = '2';

    const em = {
      create: jest.fn((_Entity: unknown, row: object) => ({ ...row })),
      query: jest.fn((sql: string, params?: unknown[]) => {
        const trimmed = sql.trimStart();
        if (
          trimmed.startsWith('UPDATE outbox_events') &&
          sql.includes('relay_delivery_attempts') &&
          sql.includes('RETURNING')
        ) {
          const rawId = params?.[0];
          const id = typeof rawId === 'string' ? rawId : '';
          const row = rows.find((candidate) => candidate.id === id);
          if (row !== undefined) {
            row.relayDeliveryAttempts = (row.relayDeliveryAttempts ?? 0) + 1;
            return [{ attempts: row.relayDeliveryAttempts }];
          }
          return [];
        }
        const allowed = params?.[1] as string[] | undefined;
        const row = rows.find(
          (candidate) =>
            candidate.processedAt === null &&
            candidate.relayDeadLetterAt === null &&
            (allowed === undefined || allowed.includes(candidate.eventType)),
        );
        return row === undefined
          ? []
          : [
              {
                id: row.id,
                messageId: row.messageId,
                eventType: row.eventType,
                entityType: row.entityType,
                entityId: row.entityId,
                schemaVersion: row.schemaVersion,
                payload: row.payload,
                envelope: row.envelope,
                createdAt: row.createdAt,
                processedAt: row.processedAt,
                relayDeliveryAttempts: row.relayDeliveryAttempts,
              },
            ];
      }),
      findOne: jest.fn((Entity: { name?: string }, opts: { where: { id: string } }) => {
        if (Entity.name === 'ArbitrageOpportunityEntity') {
          return opportunities.find((row) => row.id === opts.where.id) ?? null;
        }
        return null;
      }),
      update: jest.fn(
        (
          Entity: { name?: string },
          criteria: { id: string } & Record<string, unknown>,
          partial: Partial<OutboxEventEntity>,
        ) => {
          if (Entity.name === 'OutboxEventEntity') {
            const row = rows.find((candidate) => candidate.id === criteria.id);
            if (row !== undefined) {
              Object.assign(row, partial);
            }
          }
          return Promise.resolve({ affected: 1, generatedMaps: [], raw: [] });
        },
      ),
      save: jest.fn((Entity: { name?: string }, entity: ArbitrageOpportunityEntity) => {
        if (Entity.name === 'InboxEventEntity') {
          const duplicate = inbox.find(
            (row) =>
              row.consumerId === (entity as unknown as InboxEventEntity).consumerId &&
              row.messageId === (entity as unknown as InboxEventEntity).messageId,
          );
          if (duplicate !== undefined) {
            throw new QueryFailedError(
              'INSERT INTO inbox_events ...',
              [],
              Object.assign(new Error('duplicate key'), { code: '23505' }),
            );
          }
          inbox.push({
            ...(entity as unknown as InboxEventEntity),
            id: String(inbox.length + 1),
            receivedAt: new Date(),
            processedAt: null,
          });
          return entity;
        }
        if (Entity.name === 'ArbitrageOpportunityEntity') {
          const index = opportunities.findIndex((row) => row.id === entity.id);
          if (index >= 0) {
            opportunities[index] = entity;
          } else {
            opportunities.push(entity);
          }
        }
        return entity;
      }),
      createQueryBuilder: jest.fn(() => ({
        delete: jest.fn().mockReturnThis(),
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        execute: jest.fn(() => {
          inbox = [];
          return Promise.resolve();
        }),
      })),
    } as unknown as EntityManager;

    dataSource = {
      transaction: jest.fn(async (fn: (manager: EntityManager) => Promise<unknown>) =>
        fn(em),
      ),
    } as unknown as DataSource;

    paperClient = {
      enqueuePromotionCandidate: jest.fn().mockResolvedValue(true),
    };
    service = new OutboxRelayService(
      dataSource,
      paperClient as unknown as PaperClientService,
    );
  });

  afterEach(() => {
    delete process.env.OUTBOX_RELAY_MAX_OPPORTUNITY_ATTEMPTS;
  });

  function makeRow(
    overrides: Partial<(typeof rows)[number]> = {},
  ): (typeof rows)[number] {
    return {
      id: '1',
      messageId: '11111111-1111-4111-8111-111111111111',
      eventType: 'RiskDecisionIssued',
      entityType: 'RiskDecision',
      entityId: 'rd-1',
      schemaVersion: 1,
      payload: {
        decisionId: 'rd-1',
        planReference: 'opp-1',
      },
      envelope: {},
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      processedAt: null,
      relayDeadLetterAt: null,
      relayDeadLetterReason: null,
      relayDeliveryAttempts: 0,
      paperEnqueueIdempotencyKey: null,
      ...overrides,
    };
  }

  it('marks row processed when opportunity already matches delivered decision', async () => {
    rows.push(makeRow());
    opportunities.push({
      id: 'opp-1',
      correlationId: null,
      state: 'risk_checked',
      riskDecisionId: 'rd-1',
      payload: {},
      entityVersion: 2,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    inbox.push({
      id: '1',
      consumerId: 'opportunity-service',
      messageId: '11111111-1111-4111-8111-111111111111',
      payloadHash: null,
      receivedAt: new Date(),
      processedAt: null,
    });

    await service.processBatch();

    expect(rows[0]?.processedAt).toBeInstanceOf(Date);
    expect(rows[0]?.relayDeadLetterAt).toBeNull();
  });

  it('does not dequeue non-RiskDecisionIssued rows (shared outbox table)', async () => {
    rows.push(makeRow({ eventType: 'CapitalReserved' }));

    await service.processBatch();

    expect(rows[0]?.processedAt).toBeNull();
    expect(rows[0]?.relayDeadLetterAt).toBeNull();
  });

  it('dispatches PaperPromotionCandidateRequested and marks processed when paper HTTP succeeds', async () => {
    rows.push(
      makeRow({
        id: '2',
        eventType: 'PaperPromotionCandidateRequested',
        entityType: 'ArbitrageOpportunity',
        entityId: 'opp-2',
        payload: {
          opportunityId: '22222222-2222-4222-8222-222222222222',
          instrumentKey: 'inst:a',
          source: 'opportunity_hook',
          enqueueIdempotencyKey: '22222222-2222-4222-8222-222222222222:inst:a',
          evidence: {},
        },
      }),
    );

    await service.processBatch();

    expect(paperClient.enqueuePromotionCandidate).toHaveBeenCalledWith(
      expect.objectContaining({
        instrumentKey: 'inst:a',
        opportunityId: '22222222-2222-4222-8222-222222222222',
        enqueueIdempotencyKey: '22222222-2222-4222-8222-222222222222:inst:a',
      }),
    );
    expect(rows[0]?.processedAt).toBeInstanceOf(Date);
    expect((dataSource.transaction as jest.Mock).mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('increments relay attempts when paper promotion POST fails', async () => {
    paperClient.enqueuePromotionCandidate.mockResolvedValue(false);
    rows.push(
      makeRow({
        id: '3',
        eventType: 'PaperPromotionCandidateRequested',
        entityType: 'ArbitrageOpportunity',
        entityId: 'opp-3',
        payload: {
          opportunityId: '33333333-3333-4333-8333-333333333333',
          instrumentKey: 'inst:b',
          source: 'opportunity_hook',
          enqueueIdempotencyKey: '33333333-3333-4333-8333-333333333333:inst:b',
          evidence: {},
        },
      }),
    );

    await service.processBatch();

    expect(rows[0]?.processedAt).toBeNull();
    expect(rows[0]?.relayDeliveryAttempts).toBe(2);
    expect(rows[0]?.relayDeadLetterAt).toBeInstanceOf(Date);
  });
});
