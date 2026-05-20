import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { getArbibotMetricsRegistry } from '@arbibot/nest-platform';

import {
  BridgeTransferEntity,
  ExecutionLegEntity,
  ExecutionPlanEntity,
} from '@arbibot/persistence';

import { BridgeTransferService } from '../bridge/bridge-transfer.service';
import { CrossChainReconciliationService } from './cross-chain-reconciliation.service';

// ───────────────────────────────────────────────────────────────────────
// Helpers
// ───────────────────────────────────────────────────────────────────────

function mockBridgeTransfer(overrides: Partial<BridgeTransferEntity> = {}): BridgeTransferEntity {
  return {
    id: 'transfer-1',
    legId: 'leg-1',
    bridgeKey: 'across',
    sourceChainId: 42161,
    destinationChainId: 8453,
    sourceTxHash: '0xsrc',
    destinationTxHash: null,
    bridgeId: 'bridge-1',
    tokenAddress: '0xtoken',
    destinationTokenAddress: '0xdtoken',
    amount: '1000000',
    status: 'completed',
    estimatedRelayMs: 300000,
    actualRelayMs: null,
    idempotencyKey: 'idem-1',
    submittedAt: new Date('2026-01-01T00:00:00Z'),
    confirmedAt: null,
    failedAt: null,
    timeoutAt: null,
    errorMessage: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  } as BridgeTransferEntity;
}

function mockLeg(overrides: Partial<ExecutionLegEntity> = {}): ExecutionLegEntity {
  return {
    id: 'leg-1',
    planId: 'plan-1',
    legIndex: 0,
    state: 'filled',
    entityVersion: 1,
    venueRef: 'venue-1',
    targetQuantity: '100',
    filledQuantity: '100',
    legType: 'bridge',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  } as ExecutionLegEntity;
}

function mockPlan(overrides: Partial<ExecutionPlanEntity> = {}): ExecutionPlanEntity {
  return {
    id: 'plan-1',
    state: 'completed',
    correlationId: 'corr-1',
    capitalReservationId: 'cap-1',
    riskDecisionId: 'risk-1',
    routeKey: 'test-route',
    entityVersion: 1,
    playbookConfig: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  } as ExecutionPlanEntity;
}

// ───────────────────────────────────────────────────────────────────────
// Tests
// ───────────────────────────────────────────────────────────────────────

describe('CrossChainReconciliationService', () => {
  let service: CrossChainReconciliationService;
  let bridgeTransferRepo: { find: jest.Mock };
  let legRepo: { find: jest.Mock; findOne: jest.Mock };
  let planRepo: { findOne: jest.Mock };
  let bridgeTransferService: { getActiveTransfers: jest.Mock };

  beforeEach(async () => {
    // Clear the shared metrics registry to avoid duplicate metric errors
    getArbibotMetricsRegistry().clear();

    bridgeTransferRepo = { find: jest.fn().mockResolvedValue([]) };
    legRepo = { find: jest.fn().mockResolvedValue([]), findOne: jest.fn().mockResolvedValue(null) };
    planRepo = { findOne: jest.fn().mockResolvedValue(null) };
    bridgeTransferService = { getActiveTransfers: jest.fn().mockResolvedValue([]) };

    const module = await Test.createTestingModule({
      providers: [
        CrossChainReconciliationService,
        { provide: getRepositoryToken(BridgeTransferEntity), useValue: bridgeTransferRepo },
        { provide: getRepositoryToken(ExecutionLegEntity), useValue: legRepo },
        { provide: getRepositoryToken(ExecutionPlanEntity), useValue: planRepo },
        { provide: BridgeTransferService, useValue: bridgeTransferService },
        { provide: DataSource, useValue: {} },
      ],
    }).compile();

    service = module.get(CrossChainReconciliationService);
  });

  // ─────────────────────────────────────────────────────────────────────
  // detectBridgeMismatches
  // ─────────────────────────────────────────────────────────────────────

  describe('detectBridgeMismatches', () => {
    it('should return empty array when no completed transfers', async () => {
      bridgeTransferRepo.find.mockResolvedValue([]);

      const result = await service.detectBridgeMismatches();

      expect(result).toEqual([]);
    });

    it('should detect completed transfer without destinationTxHash', async () => {
      const transfer = mockBridgeTransfer({
        status: 'completed',
        destinationTxHash: null,
        confirmedAt: new Date('2026-01-01T01:00:00Z'),
      });
      bridgeTransferRepo.find.mockResolvedValue([transfer]);
      legRepo.findOne.mockResolvedValue(mockLeg());

      const result = await service.detectBridgeMismatches();

      expect(result).toHaveLength(1);
      expect(result[0]!.mismatchType).toBe('missing_destination_tx');
      expect(result[0]!.transferId).toBe('transfer-1');
      expect(result[0]!.planId).toBe('plan-1');
    });

    it('should detect completed transfer without confirmedAt', async () => {
      const transfer = mockBridgeTransfer({
        status: 'completed',
        destinationTxHash: '0xdest',
        confirmedAt: null,
      });
      bridgeTransferRepo.find.mockResolvedValue([transfer]);
      legRepo.findOne.mockResolvedValue(mockLeg());

      const result = await service.detectBridgeMismatches();

      expect(result).toHaveLength(1);
      expect(result[0]!.mismatchType).toBe('missing_confirmed_at');
    });

    it('should detect both missing destinationTxHash and confirmedAt', async () => {
      const transfer = mockBridgeTransfer({
        status: 'completed',
        destinationTxHash: null,
        confirmedAt: null,
      });
      bridgeTransferRepo.find.mockResolvedValue([transfer]);
      legRepo.findOne.mockResolvedValue(mockLeg());

      const result = await service.detectBridgeMismatches();

      expect(result).toHaveLength(2);
    });

    it('should return empty when completed transfer has all fields', async () => {
      const transfer = mockBridgeTransfer({
        status: 'completed',
        destinationTxHash: '0xdest',
        confirmedAt: new Date('2026-01-01T01:00:00Z'),
      });
      bridgeTransferRepo.find.mockResolvedValue([transfer]);

      const result = await service.detectBridgeMismatches();

      expect(result).toHaveLength(0);
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // detectStaleBridgeTransfers
  // ─────────────────────────────────────────────────────────────────────

  describe('detectStaleBridgeTransfers', () => {
    it('should return empty when no active transfers', async () => {
      bridgeTransferService.getActiveTransfers.mockResolvedValue([]);

      const result = await service.detectStaleBridgeTransfers();

      expect(result).toEqual([]);
    });

    it('should detect stale transfer exceeding threshold', async () => {
      const oldDate = new Date(Date.now() - 2_000_000); // > 30 min ago
      const transfer = mockBridgeTransfer({
        status: 'relaying',
        submittedAt: oldDate,
        createdAt: oldDate,
      });
      bridgeTransferService.getActiveTransfers.mockResolvedValue([transfer]);
      legRepo.findOne.mockResolvedValue(mockLeg());

      const result = await service.detectStaleBridgeTransfers(1_800_000);

      expect(result).toHaveLength(1);
      expect(result[0]!.transferId).toBe('transfer-1');
      expect(result[0]!.status).toBe('relaying');
      expect(result[0]!.ageMs).toBeGreaterThan(1_800_000);
    });

    it('should not flag fresh transfers as stale', async () => {
      const recentDate = new Date(Date.now() - 100_000); // ~1.5 min ago
      const transfer = mockBridgeTransfer({
        status: 'pending',
        submittedAt: recentDate,
        createdAt: recentDate,
      });
      bridgeTransferService.getActiveTransfers.mockResolvedValue([transfer]);

      const result = await service.detectStaleBridgeTransfers(1_800_000);

      expect(result).toHaveLength(0);
    });

    it('should use createdAt when submittedAt is null', async () => {
      const oldDate = new Date(Date.now() - 2_000_000);
      const transfer = mockBridgeTransfer({
        status: 'pending',
        submittedAt: null,
        createdAt: oldDate,
      });
      bridgeTransferService.getActiveTransfers.mockResolvedValue([transfer]);
      legRepo.findOne.mockResolvedValue(mockLeg());

      const result = await service.detectStaleBridgeTransfers(1_800_000);

      expect(result).toHaveLength(1);
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // reconcilePlan
  // ─────────────────────────────────────────────────────────────────────

  describe('reconcilePlan', () => {
    it('should throw when plan not found', async () => {
      planRepo.findOne.mockResolvedValue(null);

      await expect(service.reconcilePlan('nonexistent'))
        .rejects.toThrow('Plan not found: nonexistent');
    });

    it('should return healthy result for plan with no bridge legs', async () => {
      planRepo.findOne.mockResolvedValue(mockPlan());
      legRepo.find.mockResolvedValue([
        mockLeg({ legType: 'dex', state: 'filled' }),
        mockLeg({ id: 'leg-2', legIndex: 1, legType: 'dex', state: 'filled' }),
      ]);
      bridgeTransferRepo.find.mockResolvedValue([]);

      const result = await service.reconcilePlan('plan-1');

      expect(result.planId).toBe('plan-1');
      expect(result.totalLegs).toBe(2);
      expect(result.filledLegs).toBe(2);
      expect(result.bridgeTransfers).toBe(0);
      expect(result.healthy).toBe(true);
    });

    it('should detect mismatch in plan with bridge transfer', async () => {
      const bridgeLeg = mockLeg({ legType: 'bridge', state: 'filled' });
      planRepo.findOne.mockResolvedValue(mockPlan());
      legRepo.find.mockResolvedValue([bridgeLeg]);
      bridgeTransferRepo.find.mockResolvedValue([
        mockBridgeTransfer({
          status: 'completed',
          destinationTxHash: null,
        }),
      ]);

      const result = await service.reconcilePlan('plan-1');

      expect(result.mismatches).toHaveLength(1);
      expect(result.healthy).toBe(false);
    });

    it('should count completed bridges correctly', async () => {
      const bridgeLeg = mockLeg({ legType: 'bridge', state: 'filled' });
      planRepo.findOne.mockResolvedValue(mockPlan());
      legRepo.find.mockResolvedValue([bridgeLeg]);
      bridgeTransferRepo.find.mockResolvedValue([
        mockBridgeTransfer({
          status: 'completed',
          destinationTxHash: '0xdest',
          confirmedAt: new Date(),
        }),
      ]);

      const result = await service.reconcilePlan('plan-1');

      expect(result.completedBridges).toBe(1);
      expect(result.healthy).toBe(true);
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // runFullReconciliation
  // ─────────────────────────────────────────────────────────────────────

  describe('runFullReconciliation', () => {
    it('should return healthy status with no issues', async () => {
      bridgeTransferRepo.find.mockResolvedValue([]);
      bridgeTransferService.getActiveTransfers.mockResolvedValue([]);

      const status = await service.runFullReconciliation();

      expect(status.healthy).toBe(true);
      expect(status.totalMismatches).toBe(0);
      expect(status.totalStale).toBe(0);
      expect(status.lastCheckAt).toBeInstanceOf(Date);
    });

    it('should report mismatches and stale transfers', async () => {
      const transfer = mockBridgeTransfer({
        status: 'completed',
        destinationTxHash: null,
      });
      bridgeTransferRepo.find.mockResolvedValue([transfer]);
      legRepo.findOne.mockResolvedValue(mockLeg());

      const staleTransfer = mockBridgeTransfer({
        id: 'transfer-stale',
        status: 'pending',
        submittedAt: new Date(Date.now() - 2_000_000),
        createdAt: new Date(Date.now() - 2_000_000),
      });
      bridgeTransferService.getActiveTransfers.mockResolvedValue([staleTransfer]);

      const status = await service.runFullReconciliation(1_800_000);

      expect(status.healthy).toBe(false);
      expect(status.totalMismatches).toBeGreaterThan(0);
      expect(status.totalStale).toBeGreaterThan(0);
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // generateBridgeIncident
  // ─────────────────────────────────────────────────────────────────────

  describe('generateBridgeIncident', () => {
    it('should generate stale incident with warning severity', () => {
      const staleData = {
        transferId: 't-1',
        legId: 'l-1',
        planId: 'p-1',
        bridgeKey: 'across',
        sourceChainId: 42161,
        destinationChainId: 8453,
        status: 'relaying',
        ageMs: 2_000_000,
        timeoutThresholdMs: 1_800_000,
        detectedAt: new Date(),
      };

      const incident = service.generateBridgeIncident('stale', staleData);

      expect(incident.incidentType).toBe('bridge_transfer_stale');
      expect(incident.severity).toBe('warning');
      expect(incident.transferId).toBe('t-1');
      expect(incident.recommendedAction).toContain('force unwind');
    });

    it('should generate stale incident with critical severity when very old', () => {
      const staleData = {
        transferId: 't-1',
        legId: 'l-1',
        planId: 'p-1',
        bridgeKey: 'across',
        sourceChainId: 42161,
        destinationChainId: 8453,
        status: 'relaying',
        ageMs: 5_000_000, // > 2x threshold
        timeoutThresholdMs: 1_800_000,
        detectedAt: new Date(),
      };

      const incident = service.generateBridgeIncident('stale', staleData);

      expect(incident.severity).toBe('critical');
    });

    it('should generate mismatch incident with critical severity', () => {
      const mismatchData = {
        transferId: 't-2',
        legId: 'l-2',
        planId: 'p-2',
        bridgeKey: 'stargate',
        sourceChainId: 42161,
        destinationChainId: 56,
        mismatchType: 'missing_destination_tx' as const,
        details: 'No destination tx hash',
        detectedAt: new Date(),
      };

      const incident = service.generateBridgeIncident('mismatch', mismatchData);

      expect(incident.incidentType).toBe('bridge_transfer_mismatch');
      expect(incident.severity).toBe('critical');
      expect(incident.transferId).toBe('t-2');
      expect(incident.recommendedAction).toContain('Investigate on-chain');
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // getStatus
  // ─────────────────────────────────────────────────────────────────────

  describe('getStatus', () => {
    it('should return initial status before any check', () => {
      const status = service.getStatus();

      expect(status.lastCheckAt).toBeNull();
      expect(status.totalMismatches).toBe(0);
      expect(status.totalStale).toBe(0);
      expect(status.healthy).toBe(true);
    });
  });
});