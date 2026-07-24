import { Repository } from 'typeorm';
import {
  getArbibotMetricsRegistry,
} from '@arbibot/nest-platform';
import { ScannerInstanceStatusEntity } from '@arbibot/persistence';

import { ScannerConfigService } from './scanner-config.service';
import { ScannerWorkerService } from './scanner-worker.service';
import type { ScannerInstanceJson } from './scanner-config.types';

/**
 * Minimal ScannerConfigService mock surface used by the worker.
 * `ensureEffectiveConfigLoaded` is a no-op so tests control the instance set directly.
 */
type ConfigMock = {
  ensureEffectiveConfigLoaded: jest.Mock;
  getInstances: jest.Mock;
  getEnabledInstances: jest.Mock;
};

const makeInstance = (overrides: Partial<ScannerInstanceJson> = {}): ScannerInstanceJson => ({
  id: 'arb-2venue-1',
  name: 'Arbitrum 2-venue',
  network: 'arbitrum',
  strategy: '2venue',
  interval_ms: 1000,
  enabled: true,
  ...overrides,
});

describe('ScannerWorkerService', () => {
  let worker: ScannerWorkerService;
  let config: ConfigMock;
  let statusRepo: { findOne: jest.Mock; save: jest.Mock };

  beforeEach(() => {
    getArbibotMetricsRegistry().clear();
    config = {
      ensureEffectiveConfigLoaded: jest.fn().mockResolvedValue(undefined),
      getInstances: jest.fn().mockReturnValue([]),
      getEnabledInstances: jest.fn().mockReturnValue([]),
    };
    statusRepo = {
      findOne: jest.fn().mockResolvedValue(null),
      save: jest.fn().mockResolvedValue(undefined),
    };

    worker = new ScannerWorkerService(
      config as unknown as ScannerConfigService,
      statusRepo as unknown as Repository<ScannerInstanceStatusEntity>,
    );
  });

  afterEach(() => {
    worker.onModuleDestroy();
    jest.clearAllMocks();
  });

  describe('onModuleInit / empty instances (seed-045 default)', () => {
    it('boots without error when no instances are configured', async () => {
      // onModuleInit calls bootstrap() asynchronously; let it settle.
      await new Promise((resolve) => setImmediate(resolve));
      await new Promise((resolve) => setImmediate(resolve));

      expect(worker.getStatus().scheduledInstanceIds).toEqual([]);
      expect(worker.getStatus().runningInstanceIds).toEqual([]);
    });

    it('does not schedule timers for an empty enabled set', () => {
      config.getEnabledInstances.mockReturnValue([]);
      // Force a reconcile by invoking the private bootstrap path indirectly:
      // call onModuleInit then flush microtasks.
      worker.onModuleInit();
      expect(worker.getStatus().scheduledInstanceIds).toEqual([]);
    });
  });

  describe('runInstanceCycle (idle body)', () => {
    it('upserts the runtime row with incremented cyclesTotal on success', async () => {
      const instance = makeInstance();
      config.getInstances.mockReturnValue([instance]);
      statusRepo.findOne.mockResolvedValue({
        instanceId: instance.id,
        cyclesTotal: '4',
        findingsTotal: '2',
        opportunitiesPublishedTotal: '1',
      });

      const result = await worker.triggerInstanceRun(instance.id);

      expect(result.success).toBe(true);
      expect(config.ensureEffectiveConfigLoaded).toHaveBeenCalled();
      expect(statusRepo.save).toHaveBeenCalledTimes(1);
      const saved = statusRepo.save.mock.calls[0]?.[0] as ScannerInstanceStatusEntity;
      expect(saved.instanceId).toBe(instance.id);
      expect(saved.status).toBe('idle');
      expect(saved.cyclesTotal).toBe('5'); // 4 + 1
      expect(saved.findingsTotal).toBe('2');
      expect(saved.lastError).toBeNull();
    });

    it('starts cyclesTotal at 1 when no prior row exists', async () => {
      const instance = makeInstance({ id: 'fresh-1' });
      config.getInstances.mockReturnValue([instance]);
      statusRepo.findOne.mockResolvedValue(null);

      await worker.triggerInstanceRun(instance.id);

      const saved = statusRepo.save.mock.calls[0]?.[0] as ScannerInstanceStatusEntity;
      expect(saved.cyclesTotal).toBe('1');
    });

    it('records error status + message when config load throws', async () => {
      const instance = makeInstance();
      config.getInstances.mockReturnValue([instance]);
      config.ensureEffectiveConfigLoaded.mockRejectedValueOnce(
        new Error('config down'),
      );

      const result = await worker.triggerInstanceRun(instance.id);

      // runInstanceCycle owns the error: it catches the failure, records error status,
      // and completes the cycle without rethrowing (so a transient config outage does not
      // crash the timer). triggerInstanceRun therefore reports success=true with the
      // "cycle completed" message; the ERROR is visible in the upserted status row below.
      expect(result.success).toBe(true);
      expect(statusRepo.save).toHaveBeenCalled();
      const saved = statusRepo.save.mock.calls.at(-1)?.[0] as ScannerInstanceStatusEntity;
      expect(saved.status).toBe('error');
      expect(saved.lastError).toContain('config down');
    });

    it('returns not-found when the instance id is unknown', async () => {
      config.getInstances.mockReturnValue([makeInstance({ id: 'other' })]);

      const result = await worker.triggerInstanceRun('does-not-exist');

      expect(result.success).toBe(false);
      expect(result.message).toContain('not found');
      expect(statusRepo.save).not.toHaveBeenCalled();
    });
  });

  describe('onModuleDestroy', () => {
    it('sets isShuttingDown and clears scheduled instance ids', () => {
      worker.onModuleDestroy();
      const status = worker.getStatus();
      expect(status.isShuttingDown).toBe(true);
      expect(status.scheduledInstanceIds).toEqual([]);
    });
  });

  describe('metrics registration', () => {
    /** Sum the values of arb_scanner_cycles_total for a given (instance, status) label set. */
    const cycleCount = async (
      instanceId: string,
      status: string,
    ): Promise<number> => {
      const metrics = await getArbibotMetricsRegistry().getMetricsAsJSON();
      const counter = metrics.find(
        (m) => m.name === 'arb_scanner_cycles_total',
      ) as
        | { values?: { labels?: Record<string, string>; value?: number }[] }
        | undefined;
      const hit = counter?.values?.find(
        (v) =>
          v.labels?.instance === instanceId && v.labels?.status === status,
      );
      return hit?.value ?? 0;
    };

    it('registers arb_scanner_* metrics on the shared registry', async () => {
      const names = (await getArbibotMetricsRegistry().getMetricsAsJSON()).map(
        (m) => m.name,
      );
      expect(names).toContain('arb_scanner_cycles_total');
      expect(names).toContain('arb_scanner_cycle_latency_ms');
      expect(names).toContain('arb_scanner_instances_active');
    });

    it('increments arb_scanner_cycles_total on a successful cycle', async () => {
      const instance = makeInstance();
      config.getInstances.mockReturnValue([instance]);
      const before = await cycleCount(instance.id, 'success');

      await worker.triggerInstanceRun(instance.id);

      const after = await cycleCount(instance.id, 'success');
      expect(after).toBe(before + 1);
    });
  });
});
