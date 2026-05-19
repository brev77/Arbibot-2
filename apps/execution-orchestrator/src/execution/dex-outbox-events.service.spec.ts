import { randomUUID } from 'node:crypto';

import { Test, type TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import type { EntityManager } from 'typeorm';

import { EVENT_NAMES } from '@arbibot/contracts';
import {
  OnChainTransaction,
  OutboxEventEntity,
} from '@arbibot/persistence';

import { DexOutboxEventsService } from './dex-outbox-events.service';

function makeOnChainTx(overrides: Partial<OnChainTransaction> = {}): OnChainTransaction {
  const tx = new OnChainTransaction();
  Object.assign(tx, {
    id: 1,
    txHash: '0x' + randomUUID().replace(/-/g, ''),
    chainId: 42161,
    legId: randomUUID(),
    fromAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    toAddress: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    value: '0',
    gasLimit: '300000',
    gasUsed: null,
    gasPrice: null,
    maxPriorityFeePerGas: null,
    maxFeePerGas: null,
    status: 'pending',
    blockNumber: null,
    blockHash: null,
    transactionIndex: null,
    confirmations: 0,
    confirmedAt: null,
    revertReason: null,
    errorMessage: null,
    nonce: 42,
    inputData: null,
    createdAt: new Date('2026-05-06T12:00:00Z'),
    updatedAt: new Date('2026-05-06T12:00:00Z'),
    ...overrides,
  });
  return tx;
}

describe('DexOutboxEventsService', () => {
  let service: DexOutboxEventsService;
  let em: EntityManager;
  let savedOutbox: OutboxEventEntity[];

  beforeEach(async () => {
    savedOutbox = [];

    const mockEm = {
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn((_entity: unknown, data: unknown) => data),
      save: jest.fn((_entity: unknown, data: unknown) => {
        const row = data as OutboxEventEntity;
        savedOutbox.push(row);
        return Promise.resolve(row);
      }),
    };

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        DexOutboxEventsService,
        {
          provide: getRepositoryToken(OnChainTransaction),
          useValue: {},
        },
      ],
    }).compile();

    service = moduleRef.get(DexOutboxEventsService);
    em = mockEm as unknown as EntityManager;
    // Override the internal em methods via the mock
    (em as unknown as Record<string, unknown>).count = mockEm.count;
    (em as unknown as Record<string, unknown>).create = mockEm.create;
    (em as unknown as Record<string, unknown>).save = mockEm.save;
  });

  // -------------------------------------------------------------------------
  // emitSubmitted
  // -------------------------------------------------------------------------

  describe('emitSubmitted', () => {
    it('writes a DexTransactionSubmitted outbox row with correct envelope fields', async () => {
      const tx = makeOnChainTx({ status: 'pending' });
      const correlationId = randomUUID();

      await service.emitSubmitted(em, tx, correlationId);

      expect(savedOutbox).toHaveLength(1);
      const row = savedOutbox[0]!;
      expect(row.eventType).toBe(EVENT_NAMES.dexTransactionSubmitted);
      expect(row.entityType).toBe('OnChainTransaction');
      expect(row.entityId).toBe(tx.txHash);

      const envelope = row.envelope;
      expect(envelope.messageId).toBeDefined();
      expect(envelope.correlationId).toBe(correlationId);
      expect(envelope.entityType).toBe('OnChainTransaction');
      expect(envelope.sourceModule).toBe('execution-orchestrator');
      expect(envelope.eventName).toBe(EVENT_NAMES.dexTransactionSubmitted);

      const payload = row.payload;
      expect(payload.txHash).toBe(tx.txHash);
      expect(payload.chainId).toBe(42161);
      expect(payload.legId).toBe(tx.legId);
      expect(payload.nonce).toBe(42);
    });

    it('skips if outbox row already exists (idempotency)', async () => {
      const tx = makeOnChainTx();
      // Simulate existing row
      (em as unknown as Record<string, unknown>).count = jest.fn().mockResolvedValue(1);

      await service.emitSubmitted(em, tx, 'corr-id');

      expect(savedOutbox).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // emitConfirmed
  // -------------------------------------------------------------------------

  describe('emitConfirmed', () => {
    it('writes a DexTransactionConfirmed outbox row with receipt data', async () => {
      const confirmedAt = new Date('2026-05-06T12:01:00Z');
      const tx = makeOnChainTx({
        status: 'confirmed',
        blockNumber: 12345678,
        gasUsed: '210000',
        gasPrice: '50000000000',
        confirmations: 12,
        confirmedAt,
      });
      const correlationId = randomUUID();

      await service.emitConfirmed(em, tx, correlationId);

      expect(savedOutbox).toHaveLength(1);
      const row = savedOutbox[0]!;
      expect(row.eventType).toBe(EVENT_NAMES.dexTransactionConfirmed);

      const payload = row.payload;
      expect(payload.txHash).toBe(tx.txHash);
      expect(payload.blockNumber).toBe(12345678);
      expect(payload.gasUsed).toBe('210000');
      expect(payload.effectiveGasPrice).toBe('50000000000');
      expect(payload.confirmations).toBe(12);
      expect(payload.confirmedAt).toBe(confirmedAt.toISOString());
    });
  });

  // -------------------------------------------------------------------------
  // emitFailed
  // -------------------------------------------------------------------------

  describe('emitFailed', () => {
    it('writes a DexTransactionFailed outbox row with error details', async () => {
      const tx = makeOnChainTx({
        status: 'reverted',
        blockNumber: 12345678,
        gasUsed: '150000',
        gasPrice: '50000000000',
        revertReason: 'UniswapV2: INSUFFICIENT_OUTPUT_AMOUNT',
        errorMessage: null,
      });
      const correlationId = randomUUID();

      await service.emitFailed(em, tx, correlationId);

      expect(savedOutbox).toHaveLength(1);
      const row = savedOutbox[0]!;
      expect(row.eventType).toBe(EVENT_NAMES.dexTransactionFailed);

      const payload = row.payload;
      expect(payload.txHash).toBe(tx.txHash);
      expect(payload.revertReason).toBe('UniswapV2: INSUFFICIENT_OUTPUT_AMOUNT');
      expect(payload.failedAt).toBeDefined();
    });

    it('handles failed status with errorMessage instead of revertReason', async () => {
      const tx = makeOnChainTx({
        status: 'failed',
        revertReason: null,
        errorMessage: 'Transaction was dropped from mempool',
      });

      await service.emitFailed(em, tx, 'corr-id');

      expect(savedOutbox).toHaveLength(1);
      const payload = savedOutbox[0]!.payload;
      expect(payload.errorMessage).toBe('Transaction was dropped from mempool');
      expect(payload.revertReason).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Envelope integrity
  // -------------------------------------------------------------------------

  describe('envelope fields', () => {
    it('includes all required envelope fields per async-events.md', async () => {
      const tx = makeOnChainTx();
      const correlationId = randomUUID();

      await service.emitSubmitted(em, tx, correlationId);

      const envelope = savedOutbox[0]!.envelope;
      expect(envelope).toHaveProperty('messageId');
      expect(envelope).toHaveProperty('correlationId');
      expect(envelope).toHaveProperty('causationId');
      expect(envelope).toHaveProperty('entityType');
      expect(envelope).toHaveProperty('entityId');
      expect(envelope).toHaveProperty('version');
      expect(envelope).toHaveProperty('sourceModule');
      expect(envelope).toHaveProperty('eventTs');
      expect(envelope).toHaveProperty('eventName');
      expect(envelope).toHaveProperty('payload');
    });

    it('uses legId as causationId when present', async () => {
      const legId = randomUUID();
      const tx = makeOnChainTx({ legId });

      await service.emitSubmitted(em, tx, 'corr-id');

      const envelope = savedOutbox[0]!.envelope;
      expect(envelope.causationId).toBe(legId);
    });

    it('uses messageId as causationId when legId is null', async () => {
      const tx = makeOnChainTx({ legId: null });

      await service.emitSubmitted(em, tx, 'corr-id');

      const envelope = savedOutbox[0]!.envelope;
      expect(envelope.causationId).toBe(envelope.messageId);
    });
  });
});