import { NotFoundException } from '@nestjs/common';

import { ScannerController } from './scanner.controller';
import type { ScannerConfigService } from './scanner-config.service';
import type { ScannerFindingsService } from './scanner-findings.service';
import type { ScannerWorkerService } from './scanner-worker.service';
import type { ScannerRpcService } from './scanner-rpc.service';
import type { ScannerInstanceJson } from './scanner-config.types';

const makeInstance = (overrides: Partial<ScannerInstanceJson> = {}): ScannerInstanceJson => ({
  id: 'arb-2venue-1',
  name: 'Arbitrum 2-venue',
  network: 'arbitrum',
  strategy: '2venue',
  interval_ms: 2000,
  enabled: true,
  ...overrides,
});

describe('ScannerController', () => {
  let config: { getInstances: jest.Mock; getEnabledInstances: jest.Mock; forceRefresh: jest.Mock; getConfig: jest.Mock };
  let worker: { triggerInstanceRun: jest.Mock; getStatus: jest.Mock };
  let findings: { list: jest.Mock; getById: jest.Mock };
  let rpc: { getAllHealthStatus: jest.Mock };
  let controller: ScannerController;

  beforeEach(() => {
    config = {
      getInstances: jest.fn().mockReturnValue([makeInstance()]),
      getEnabledInstances: jest.fn().mockReturnValue([makeInstance()]),
      forceRefresh: jest.fn().mockResolvedValue(undefined),
      getConfig: jest.fn().mockReturnValue({ defaults: { configCacheTtlMs: 30000 } }),
    };
    worker = {
      triggerInstanceRun: jest.fn().mockResolvedValue({ success: true, message: 'cycle completed' }),
      getStatus: jest.fn().mockReturnValue({ isShuttingDown: false, scheduledInstanceIds: ['arb-2venue-1'], runningInstanceIds: [] }),
    };
    findings = {
      list: jest.fn().mockResolvedValue([]),
      getById: jest.fn().mockResolvedValue({ id: 'f-1' }),
    };
    rpc = { getAllHealthStatus: jest.fn().mockReturnValue({ '42161': { healthy: true } }) };
    controller = new ScannerController(
      config as unknown as ScannerConfigService,
      worker as unknown as ScannerWorkerService,
      findings as unknown as ScannerFindingsService,
      rpc as unknown as ScannerRpcService,
    );
  });

  describe('GET /scanner/instances', () => {
    it('lists instances with config fields', () => {
      const result = controller.listInstances();
      expect(result.instances).toHaveLength(1);
      expect(result.instances[0]?.id).toBe('arb-2venue-1');
      expect(result.instances[0]?.enabled).toBe(true);
    });

    it('returns empty array when no instances configured', () => {
      config.getInstances.mockReturnValue([]);
      const result = controller.listInstances();
      expect(result.instances).toEqual([]);
    });
  });

  describe('GET /scanner/instances/:id', () => {
    it('returns instance + worker status', () => {
      const result = controller.getInstance('arb-2venue-1') as {
        instance: { id: string };
        worker: unknown;
      };
      expect(result.instance.id).toBe('arb-2venue-1');
      expect(result.worker).toBeDefined();
    });

    it('returns 404-shape when instance not found', () => {
      config.getInstances.mockReturnValue([makeInstance({ id: 'other' })]);
      const result = controller.getInstance('missing');
      expect(result.error).toContain('not found');
      expect(result.statusCode).toBe(404);
    });
  });

  describe('POST /scanner/instances/:id/refresh-config', () => {
    it('force-refreshes config and reports applied=true when instance still exists', async () => {
      const result = await controller.refreshInstanceConfig('arb-2venue-1');
      expect(config.forceRefresh).toHaveBeenCalled();
      expect(result.applied).toBe(true);
    });

    it('reports applied=false when instance was removed by the refresh', async () => {
      config.getInstances.mockReturnValue([]);
      const result = await controller.refreshInstanceConfig('gone');
      expect(result.applied).toBe(false);
    });
  });

  describe('POST /scanner/instances/:id/run', () => {
    it('delegates to the worker', async () => {
      const result = await controller.runInstance('arb-2venue-1');
      expect(worker.triggerInstanceRun).toHaveBeenCalledWith('arb-2venue-1');
      expect(result.success).toBe(true);
    });
  });

  describe('GET /scanner/findings', () => {
    it('lists findings with default limit 100', async () => {
      await controller.listFindings(undefined, undefined, undefined);
      expect(findings.list).toHaveBeenCalledWith(undefined, undefined, 100);
    });

    it('clamps limit and forwards filters', async () => {
      await controller.listFindings('arb-2venue-1', 'pending', '50');
      expect(findings.list).toHaveBeenCalledWith('arb-2venue-1', 'pending', 50);
    });

    it('falls back to 100 on non-numeric limit', async () => {
      await controller.listFindings(undefined, undefined, 'abc');
      expect(findings.list).toHaveBeenCalledWith(undefined, undefined, 100);
    });
  });

  describe('GET /scanner/findings/:id', () => {
    it('returns the finding', async () => {
      const result = await controller.getFinding('f-1');
      expect(findings.getById).toHaveBeenCalledWith('f-1');
      expect(result.id).toBe('f-1');
    });

    it('propagates NotFoundException from the service', async () => {
      findings.getById.mockRejectedValue(new NotFoundException('not found'));
      await expect(controller.getFinding('missing')).rejects.toThrow(NotFoundException);
    });
  });

  describe('POST /scanner/findings/:id/re-publish (stub)', () => {
    it('returns 501 Not Implemented', () => {
      const result = controller.republishFinding('f-1');
      expect(result.statusCode).toBe(501);
      expect(result.message).toContain('Phase 3-2');
    });
  });

  describe('GET /scanner/status', () => {
    it('returns composite worker + instances + rpc + config snapshot', () => {
      const result = controller.getStatus();
      expect(result.worker).toBeDefined();
      expect(result.instances.total).toBe(1);
      expect(result.instances.enabled).toBe(1);
      expect(result.rpc).toBeDefined();
      expect(result.configCacheTtlMs).toBe(30000);
    });
  });
});
