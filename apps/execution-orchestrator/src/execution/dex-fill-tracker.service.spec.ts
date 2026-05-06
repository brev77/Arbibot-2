import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { OnChainTransaction } from '@arbibot/persistence';

import { DexFillTrackerService } from './dex-fill-tracker.service';

function makeTx(overrides: Partial<OnChainTransaction> = {}): OnChainTransaction {
  return Object.assign(new OnChainTransaction(), {
    id: 1,
    txHash: '0xabc123',
    chainId: 42161,
    legId: 'leg-uuid-001',
    fromAddress: '0xfrom',
    toAddress: '0xto',
    value: '0',
    gasLimit: '300000',
    gasUsed: '210000',
    gasPrice: '1000000000',
    maxPriorityFeePerGas: null,
    maxFeePerGas: null,
    status: 'confirmed' as const,
    blockNumber: 12345678,
    blockHash: '0xblock',
    transactionIndex: 0,
    confirmations: 12,
    confirmedAt: new Date('2026-05-05T00:00:00Z'),
    revertReason: null,
    errorMessage: null,
    nonce: 42,
    inputData: null,
    createdAt: new Date('2026-05-05T00:00:00Z'),
    updatedAt: new Date('2026-05-05T00:00:00Z'),
    ...overrides,
  });
}

describe('DexFillTrackerService', () => {
  let service: DexFillTrackerService;
  let repo: jest.Mocked<Repository<OnChainTransaction>>;

  beforeEach(async () => {
    const mockRepo = {
      findOne: jest.fn(),
      find: jest.fn(),
      count: jest.fn(),
    };

    const module = await Test.createTestingModule({
      providers: [
        DexFillTrackerService,
        {
          provide: getRepositoryToken(OnChainTransaction),
          useValue: mockRepo,
        },
      ],
    }).compile();

    service = module.get(DexFillTrackerService);
    repo = module.get(getRepositoryToken(OnChainTransaction));
  });

  describe('getDexFillMetadata', () => {
    it('returns null when no confirmed tx exists for leg', async () => {
      repo.findOne.mockResolvedValue(null);

      const result = await service.getDexFillMetadata('leg-no-tx');

      expect(result).toBeNull();
      expect(repo.findOne).toHaveBeenCalledWith({
        where: { legId: 'leg-no-tx', status: 'confirmed' },
        order: { createdAt: 'DESC' },
      });
    });

    it('returns DexFillMetadata when confirmed tx exists', async () => {
      const tx = makeTx();
      repo.findOne.mockResolvedValue(tx);

      const result = await service.getDexFillMetadata('leg-uuid-001');

      expect(result).toEqual({
        txHash: '0xabc123',
        chainId: 42161,
        gasUsed: '210000',
        effectiveGasPrice: '1000000000',
        blockNumber: 12345678,
        fromAddress: '0xfrom',
        toAddress: '0xto',
      });
    });

    it('returns most recent confirmed tx when multiple exist', async () => {
      const latestTx = makeTx({ txHash: '0xlatest', createdAt: new Date('2026-05-05T12:00:00Z') });
      repo.findOne.mockResolvedValue(latestTx);

      const result = await service.getDexFillMetadata('leg-multi');

      expect(result?.txHash).toBe('0xlatest');
      expect(repo.findOne).toHaveBeenCalledWith({
        where: { legId: 'leg-multi', status: 'confirmed' },
        order: { createdAt: 'DESC' },
      });
    });

    it('returns null fields for tx without gas/block data', async () => {
      const tx = makeTx({
        gasUsed: null,
        gasPrice: null,
        blockNumber: null,
      });
      repo.findOne.mockResolvedValue(tx);

      const result = await service.getDexFillMetadata('leg-partial');

      expect(result).toEqual({
        txHash: '0xabc123',
        chainId: 42161,
        gasUsed: null,
        effectiveGasPrice: null,
        blockNumber: null,
        fromAddress: '0xfrom',
        toAddress: '0xto',
      });
    });

    it('is idempotent: repeated calls return same result', async () => {
      const tx = makeTx();
      repo.findOne.mockResolvedValue(tx);

      const first = await service.getDexFillMetadata('leg-idem');
      const second = await service.getDexFillMetadata('leg-idem');

      expect(first).toEqual(second);
      expect(repo.findOne).toHaveBeenCalledTimes(2);
    });
  });

  describe('hasOnChainTransaction', () => {
    it('returns false when no tx exists', async () => {
      repo.count.mockResolvedValue(0);

      const result = await service.hasOnChainTransaction('leg-none');

      expect(result).toBe(false);
    });

    it('returns true when tx exists regardless of status', async () => {
      repo.count.mockResolvedValue(2);

      const result = await service.hasOnChainTransaction('leg-has-tx');

      expect(result).toBe(true);
      expect(repo.count).toHaveBeenCalledWith({
        where: { legId: 'leg-has-tx' },
      });
    });
  });

  describe('getTransactionsForLeg', () => {
    it('returns empty array when no transactions', async () => {
      repo.find.mockResolvedValue([]);

      const result = await service.getTransactionsForLeg('leg-empty');

      expect(result).toEqual([]);
    });

    it('returns transactions ordered by createdAt', async () => {
      const tx1 = makeTx({ id: 1, createdAt: new Date('2026-05-05T10:00:00Z') });
      const tx2 = makeTx({ id: 2, createdAt: new Date('2026-05-05T12:00:00Z') });
      repo.find.mockResolvedValue([tx1, tx2]);

      const result = await service.getTransactionsForLeg('leg-multi');

      expect(result).toHaveLength(2);
      expect(repo.find).toHaveBeenCalledWith({
        where: { legId: 'leg-multi' },
        order: { createdAt: 'ASC' },
      });
    });
  });
});