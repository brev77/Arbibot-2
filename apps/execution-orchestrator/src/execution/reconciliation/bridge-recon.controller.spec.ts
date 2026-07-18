import { HttpStatus } from '@nestjs/common';

import { BridgeReconController } from './bridge-recon.controller';
import { CrossChainReconciliationService } from './cross-chain-reconciliation.service';

/**
 * BridgeReconController spec (Phase 4 — controller coverage).
 *
 * Three endpoints over CrossChainReconciliationService:
 *   GET  /status     — ISO projection of the in-memory status snapshot
 *   GET  /mismatches — detectBridgeMismatches + detectStaleBridgeTransfers
 *                      with row-view ISO mapping + incident descriptors
 *   POST /trigger    — runFullReconciliation with ISO projection
 *
 * We stub the service to exercise: empty path, mismatch path, stale path,
 * both, and the lastCheckAt null/non-null projection on /status.
 */
describe('BridgeReconController', () => {
  let recon: {
    getStatus: jest.Mock;
    detectBridgeMismatches: jest.Mock;
    detectStaleBridgeTransfers: jest.Mock;
    generateBridgeIncident: jest.Mock;
    runFullReconciliation: jest.Mock;
  };
  let controller: BridgeReconController;

  beforeEach(() => {
    recon = {
      getStatus: jest.fn(),
      detectBridgeMismatches: jest.fn(),
      detectStaleBridgeTransfers: jest.fn(),
      generateBridgeIncident: jest.fn(),
      runFullReconciliation: jest.fn(),
    };
    controller = new BridgeReconController(
      recon as unknown as CrossChainReconciliationService,
    );
  });

  describe('getStatus', () => {
    it('projects lastCheckAt to ISO string when present', () => {
      recon.getStatus.mockReturnValue({
        lastCheckAt: new Date('2026-07-17T10:00:00.000Z'),
        totalMismatches: 2,
        totalStale: 1,
        checkedPlans: 10,
        healthy: false,
      });
      const out = controller.getStatus();
      expect(out).toEqual({
        lastCheckAt: '2026-07-17T10:00:00.000Z',
        totalMismatches: 2,
        totalStale: 1,
        checkedPlans: 10,
        healthy: false,
      });
    });

    it('projects lastCheckAt to null when never run', () => {
      recon.getStatus.mockReturnValue({
        lastCheckAt: null,
        totalMismatches: 0,
        totalStale: 0,
        checkedPlans: 0,
        healthy: true,
      });
      expect(controller.getStatus().lastCheckAt).toBeNull();
    });
  });

  describe('getMismatches', () => {
    it('returns empty arrays when no mismatches and no stale transfers', async () => {
      recon.detectBridgeMismatches.mockResolvedValue([]);
      recon.detectStaleBridgeTransfers.mockResolvedValue([]);
      const out = await controller.getMismatches();
      expect(out.mismatches).toEqual([]);
      expect(out.staleTransfers).toEqual([]);
      expect(out.incidents).toEqual([]);
    });

    it('maps mismatches to ISO detectedAt and generates incidents', async () => {
      const detectedAt = new Date('2026-07-17T11:00:00.000Z');
      recon.detectBridgeMismatches.mockResolvedValue([
        {
          transferId: 't1',
          legId: 'leg-1',
          planId: 'plan-1',
          bridgeKey: 'across',
          sourceChainId: 1,
          destinationChainId: 137,
          mismatchType: 'amount',
          details: { expected: '1.0', actual: '0.99' },
          detectedAt,
        },
      ]);
      recon.detectStaleBridgeTransfers.mockResolvedValue([]);
      recon.generateBridgeIncident.mockImplementation((kind, m) => ({
        kind,
        id: (m as { transferId: string }).transferId,
      }));
      const out = await controller.getMismatches();
      expect(out.mismatches).toHaveLength(1);
      expect(out.mismatches[0]?.detectedAt).toBe(
        '2026-07-17T11:00:00.000Z',
      );
      expect(out.mismatches[0]?.mismatchType).toBe('amount');
      expect(out.incidents).toEqual([
        { kind: 'mismatch', id: 't1' },
      ]);
    });

    it('maps stale transfers with ageMs/timeout and generates incidents', async () => {
      const detectedAt = new Date('2026-07-17T11:00:00.000Z');
      recon.detectBridgeMismatches.mockResolvedValue([]);
      recon.detectStaleBridgeTransfers.mockResolvedValue([
        {
          transferId: 't2',
          legId: 'leg-2',
          planId: 'plan-2',
          bridgeKey: 'native',
          sourceChainId: 10,
          destinationChainId: 42161,
          status: 'pending',
          ageMs: 7_200_000,
          timeoutThresholdMs: 3_600_000,
          detectedAt,
        },
      ]);
      recon.generateBridgeIncident.mockImplementation((kind, s) => ({
        kind,
        id: (s as { transferId: string }).transferId,
      }));
      const out = await controller.getMismatches();
      expect(out.staleTransfers).toHaveLength(1);
      expect(out.staleTransfers[0]?.ageMs).toBe(7_200_000);
      expect(out.staleTransfers[0]?.timeoutThresholdMs).toBe(3_600_000);
      expect(out.staleTransfers[0]?.detectedAt).toBe(
        '2026-07-17T11:00:00.000Z',
      );
      expect(out.incidents).toEqual([
        { kind: 'stale', id: 't2' },
      ]);
    });

    it('combines both mismatch and stale incidents in order', async () => {
      recon.detectBridgeMismatches.mockResolvedValue([
        {
          transferId: 't1',
          legId: 'l1',
          planId: 'p1',
          bridgeKey: 'b',
          sourceChainId: 1,
          destinationChainId: 2,
          mismatchType: 'x',
          details: {},
          detectedAt: new Date(),
        },
      ]);
      recon.detectStaleBridgeTransfers.mockResolvedValue([
        {
          transferId: 't2',
          legId: 'l2',
          planId: 'p2',
          bridgeKey: 'b',
          sourceChainId: 1,
          destinationChainId: 2,
          status: 'pending',
          ageMs: 1,
          timeoutThresholdMs: 2,
          detectedAt: new Date(),
        },
      ]);
      recon.generateBridgeIncident.mockImplementation((kind) => ({
        kind,
      }));
      const out = await controller.getMismatches();
      expect(
        out.incidents.map((i) => (i as unknown as { kind: string }).kind),
      ).toEqual(['mismatch', 'stale']);
    });
  });

  describe('trigger', () => {
    it('runs full reconciliation and projects ISO lastCheckAt', async () => {
      recon.runFullReconciliation.mockResolvedValue({
        lastCheckAt: new Date('2026-07-17T12:00:00.000Z'),
        totalMismatches: 0,
        totalStale: 0,
        checkedPlans: 5,
        healthy: true,
      });
      const out = await controller.trigger();
      expect(out.lastCheckAt).toBe('2026-07-17T12:00:00.000Z');
      expect(out.checkedPlans).toBe(5);
      expect(out.healthy).toBe(true);
    });

    it('HttpCode(200) decorator is applied to the trigger handler', () => {
      expect(
        Reflect.getMetadata('__httpCode__', controller.trigger),
      ).toBe(HttpStatus.OK);
    });
  });
});
