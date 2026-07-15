import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { BridgeTransferEntity } from '@arbibot/persistence';

import type { BridgeAdapter, BridgeTransferParams } from './bridge-adapter.interface';
import { BridgeTransferService } from './bridge-transfer.service';
import { BridgeFinalityService } from './bridge-finality.service';

describe('BridgeTransferService', () => {
  let service: BridgeTransferService;

  const mockFindOne = jest.fn();
  const mockCreate = jest.fn();
  const mockSave = jest.fn();
  const mockUpdate = jest.fn();
  const mockFind = jest.fn();

  const mockRepo = {
    findOne: mockFindOne,
    create: mockCreate,
    save: mockSave,
    update: mockUpdate,
    find: mockFind,
  };

  const mockDataSource = { createQueryBuilder: jest.fn() };

  const mockFinalityService = {
    getRequiredConfirmationsFor: jest.fn().mockReturnValue(1),
    getSourceConfirmations: jest.fn().mockResolvedValue(0),
  };

  const mockAdapter: BridgeAdapter = {
    bridgeKey: 'across',
    supportedChains: [[42161, 8453] as const],
    submitBridgeTransfer: jest.fn().mockResolvedValue({
      sourceTxHash: '0xsrc',
      sourceChainId: 42161,
      destinationChainId: 8453,
      bridgeId: 'bridge-123',
      estimatedRelayMs: 240000,
    }),
    checkBridgeStatus: jest.fn().mockResolvedValue({
      status: 'pending',
      sourceTxHash: '0xsrc',
      destinationTxHash: null,
      confirmations: 0,
      estimatedCompletionMs: 240000,
    }),
    estimateBridgeFee: jest.fn().mockResolvedValue({
      bridgeFee: 0n,
      relayerFee: 0n,
      estimatedGasSource: 200000n,
      estimatedGasDestination: 100000n,
      totalEstimatedCostUsd: 0,
    }),
    estimateRelayTime: jest.fn().mockResolvedValue(240000),
  };

  const defaultParams: BridgeTransferParams = {
    sourceChainId: 42161,
    destinationChainId: 8453,
    token: '0xtoken',
    destinationToken: '0xdesttoken',
    amount: 1000000000000000000n,
    recipientAddress: '0xrecipient',
    idempotencyKey: 'plan:1:across',
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    mockFinalityService.getRequiredConfirmationsFor.mockReturnValue(1);
    mockFinalityService.getSourceConfirmations.mockResolvedValue(0);

    const module = await Test.createTestingModule({
      providers: [
        BridgeTransferService,
        { provide: getRepositoryToken(BridgeTransferEntity), useValue: mockRepo },
        { provide: DataSource, useValue: mockDataSource },
        { provide: BridgeFinalityService, useValue: mockFinalityService },
      ],
    }).compile();

    service = module.get(BridgeTransferService);
  });

  describe('generateIdempotencyKey', () => {
    it('should generate deterministic key', () => {
      const key = BridgeTransferService.generateIdempotencyKey('plan-1', 0, 'across');
      expect(key).toBe('plan-1:0:across');
    });
  });

  describe('submitBridgeTransfer', () => {
    it('should create new transfer when no existing record', async () => {
      mockFindOne.mockResolvedValueOnce(null);
      mockCreate.mockReturnValue({
        id: 'new-transfer-id',
        legId: 'leg-1',
        status: 'pending',
        idempotencyKey: 'plan:1:across',
      });
      mockSave.mockResolvedValue({
        id: 'new-transfer-id',
        legId: 'leg-1',
        bridgeKey: 'across',
        sourceChainId: 42161,
        destinationChainId: 8453,
        status: 'pending',
      });

      const result = await service.submitBridgeTransfer(mockAdapter, defaultParams, 'leg-1');

      expect(mockFindOne).toHaveBeenCalledWith({
        where: { idempotencyKey: 'plan:1:across' },
      });
      // required_confirmations snapshot captured at submit (D4-B-5-BRIDGE, L5)
      expect(mockFinalityService.getRequiredConfirmationsFor).toHaveBeenCalledWith(42161);
      expect(mockSave).toHaveBeenCalled();
      expect(result.id).toBe('new-transfer-id');
    });

    it('should return existing active transfer', async () => {
      mockFindOne.mockResolvedValueOnce({
        id: 'existing-id',
        status: 'relaying',
        idempotencyKey: 'plan:1:across',
      });

      const result = await service.submitBridgeTransfer(mockAdapter, defaultParams, 'leg-1');

      expect(mockAdapter.submitBridgeTransfer).not.toHaveBeenCalled();
      expect(result.id).toBe('existing-id');
    });

    it('should throw on terminal state without operator approval', async () => {
      mockFindOne.mockResolvedValueOnce({
        id: 'failed-id',
        status: 'failed',
        idempotencyKey: 'plan:1:across',
      });

      await expect(
        service.submitBridgeTransfer(mockAdapter, defaultParams, 'leg-1'),
      ).rejects.toThrow('terminal state');
    });

    it('idempotent claim: re-submit returns existing active (B1)', async () => {
      // B1 protection: a second submit with the same idempotency key must not
      // create a duplicate — the existing active transfer is returned.
      mockFindOne.mockResolvedValueOnce({
        id: 'existing-active',
        status: 'confirming',
        idempotencyKey: 'plan:1:across',
      });

      const result = await service.submitBridgeTransfer(mockAdapter, defaultParams, 'leg-1');

      expect(mockAdapter.submitBridgeTransfer).not.toHaveBeenCalled();
      expect(result.id).toBe('existing-active');
    });
  });

  describe('getById', () => {
    it('should find by id', async () => {
      mockFindOne.mockResolvedValueOnce({ id: 'test-id' });
      const result = await service.getById('test-id');
      expect(result?.id).toBe('test-id');
    });

    it('should return null when not found', async () => {
      mockFindOne.mockResolvedValueOnce(null);
      const result = await service.getById('nonexistent');
      expect(result).toBeNull();
    });
  });

  describe('getByLegId', () => {
    it('should find by leg id', async () => {
      mockFindOne.mockResolvedValueOnce({ id: 'transfer-id', legId: 'leg-1' });
      const result = await service.getByLegId('leg-1');
      expect(result?.legId).toBe('leg-1');
    });
  });

  describe('markTimedOut', () => {
    it('should update status to timed_out', async () => {
      mockUpdate.mockResolvedValueOnce({ affected: 1 });
      mockFindOne.mockResolvedValueOnce({
        id: 'transfer-id',
        status: 'timed_out',
        failedAt: new Date(),
      });

      const result = await service.markTimedOut('transfer-id');

      expect(mockUpdate).toHaveBeenCalledWith(
        'transfer-id',
        expect.objectContaining({ status: 'timed_out' }),
      );
      expect(result.status).toBe('timed_out');
    });

    it('should write errorMessage on timeout (L5)', async () => {
      mockUpdate.mockResolvedValueOnce({ affected: 1 });
      mockFindOne.mockResolvedValueOnce({
        id: 'transfer-id',
        status: 'timed_out',
        errorMessage: 'relay deadline exceeded',
      });

      await service.markTimedOut('transfer-id', 'relay deadline exceeded');

      expect(mockUpdate).toHaveBeenCalledWith(
        'transfer-id',
        expect.objectContaining({ errorMessage: 'relay deadline exceeded' }),
      );
    });
  });

  describe('getActiveTransfers', () => {
    it('should query for pending/relaying/confirming', async () => {
      mockFind.mockResolvedValueOnce([
        { id: 't1', status: 'pending' },
        { id: 't2', status: 'relaying' },
      ]);

      const results = await service.getActiveTransfers();

      expect(mockFind).toHaveBeenCalledWith({
        where: [
          { status: 'pending' },
          { status: 'relaying' },
          { status: 'confirming' },
        ],
      });
      expect(results).toHaveLength(2);
    });
  });

  describe('pollAndUpdateStatus', () => {
    it('should transition to completed and set finalizedAt (L5)', async () => {
      // Adapter reports completed with a destination tx hash.
      (mockAdapter.checkBridgeStatus as jest.Mock).mockResolvedValueOnce({
        status: 'completed',
        sourceTxHash: '0xsrc',
        destinationTxHash: '0xdest',
        confirmations: 5,
        estimatedCompletionMs: 0,
      });
      mockFindOne.mockResolvedValueOnce({
        id: 'updated-id',
        status: 'completed',
        destinationTxHash: '0xdest',
        finalizedAt: new Date(),
      });

      const entity = {
        id: 't1',
        bridgeId: 'bridge-123',
        sourceChainId: 42161,
        destinationChainId: 8453,
        sourceTxHash: '0xsrc',
        amount: '1000000000000000000',
        tokenAddress: '0xtoken',
        destinationTokenAddress: '0xdesttoken',
        status: 'relaying',
        destinationConfirmations: 0,
        submittedAt: new Date(),
      } as BridgeTransferEntity;

      const updated = await service.pollAndUpdateStatus(entity, mockAdapter);

      expect(mockAdapter.checkBridgeStatus).toHaveBeenCalledWith(
        expect.objectContaining({
          bridgeId: 'bridge-123',
          sourceChainId: 42161,
          destinationChainId: 8453,
          sourceTxHash: '0xsrc',
        }),
      );
      expect(mockUpdate).toHaveBeenCalledWith(
        't1',
        expect.objectContaining({
          status: 'completed',
          destinationTxHash: '0xdest',
          finalizedAt: expect.any(Date),
        }),
      );
      expect(updated.status).toBe('completed');
    });

    it('should write errorMessage on adapter-reported failed (L5)', async () => {
      (mockAdapter.checkBridgeStatus as jest.Mock).mockResolvedValueOnce({
        status: 'failed',
        sourceTxHash: '0xsrc',
        destinationTxHash: null,
        confirmations: 0,
        estimatedCompletionMs: 0,
      });
      mockFindOne.mockResolvedValueOnce({
        id: 't1',
        status: 'failed',
        errorMessage: expect.any(String),
      });

      const entity = {
        id: 't1',
        bridgeId: 'bridge-123',
        sourceChainId: 42161,
        destinationChainId: 8453,
        sourceTxHash: '0xsrc',
        amount: '1',
        tokenAddress: '0xtoken',
        destinationTokenAddress: '0xdesttoken',
        status: 'relaying',
        bridgeKey: 'across',
      } as BridgeTransferEntity;

      await service.pollAndUpdateStatus(entity, mockAdapter);

      expect(mockUpdate).toHaveBeenCalledWith(
        't1',
        expect.objectContaining({
          status: 'failed',
          errorMessage: expect.stringContaining('failed'),
        }),
      );
    });

    it('should not transition when status unchanged (no-op)', async () => {
      (mockAdapter.checkBridgeStatus as jest.Mock).mockResolvedValueOnce({
        status: 'pending',
        sourceTxHash: '0xsrc',
        destinationTxHash: null,
        confirmations: 0,
        estimatedCompletionMs: 0,
      });

      const entity = {
        id: 't1',
        bridgeId: 'bridge-123',
        sourceChainId: 42161,
        destinationChainId: 8453,
        sourceTxHash: '0xsrc',
        amount: '1',
        tokenAddress: '0xtoken',
        destinationTokenAddress: '0xdesttoken',
        status: 'pending',
        destinationConfirmations: 0,
      } as BridgeTransferEntity;

      await service.pollAndUpdateStatus(entity, mockAdapter);

      // No status update issued when nothing changed.
      expect(mockUpdate).not.toHaveBeenCalled();
    });
  });
});
