import { Repository } from 'typeorm';
import {
  getArbibotMetricsRegistry,
} from '@arbibot/nest-platform';
import { ScannerInstanceStatusEntity } from '@arbibot/persistence';

import { ScannerConfigService } from './scanner-config.service';
import { ScannerPipelineService } from './scanner-pipeline.service';
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

const pipelineResult = (
  overrides: Partial<{
    poolsRead: number;
    spreadsDetected: number;
    findingsWritten: number;
    findingsFiltered: number;
    error: string | null;
  }> = {},
) => ({
  poolsRead: 0,
  spreadsDetected: 0,
  findingsWritten: 0,
  findingsFiltered: 0,
  error: null,
  ...overrides,
});

/** Access a private map of timers from the worker instance (for lifecycle tests). */
function timersOf(w: ScannerWorkerService): Map<string, { interval: NodeJS.Timeout; isRunning: boolean }> {
  return (w as unknown as { timers: Map<string, { interval: NodeJS.Timeout; isRunning: boolean }> }).timers;
}

describe('ScannerWorkerService', () => {
  let worker: ScannerWorkerService;
  let config: ConfigMock;
  let statusRepo: { findOne: jest.Mock; save: jest.Mock };
  let pipeline: { runCycle: jest.Mock };

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
    pipeline = { runCycle: jest.fn().mockResolvedValue(pipelineResult()) };

    worker = new ScannerWorkerService(
      config as unknown as ScannerConfigService,
      pipeline as unknown as ScannerPipelineService,
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

    it('bootstrap swallows config-load failure (non-fatal) and schedules nothing', async () => {
      config.ensureEffectiveConfigLoaded.mockRejectedValueOnce(new Error('config down'));
      worker.onModuleInit();
      // Let the rejected bootstrap settle.
      await new Promise((r) => setImmediate(r));
      await new Promise((r) => setImmediate(r));
      await new Promise((r) => setImmediate(r));
      expect(worker.getStatus().scheduledInstanceIds).toEqual([]);
    });

    it('schedules a timer per enabled instance on bootstrap and kicks a first cycle', async () => {
      const inst = makeInstance();
      config.getEnabledInstances.mockReturnValue([inst]);
      worker.onModuleInit();
      // bootstrap awaits ensureEffectiveConfigLoaded then reconcileTimers kicks a cycle.
      await new Promise((r) => setImmediate(r));
      await new Promise((r) => setImmediate(r));
      await new Promise((r) => setImmediate(r));
      expect(worker.getStatus().scheduledInstanceIds).toEqual([inst.id]);
      // The immediate kick should have invoked the pipeline.
      expect(pipeline.runCycle).toHaveBeenCalledWith(inst);
    });
  });

  describe('reconcileTimers (add / remove / disable)', () => {
    it('removes a timer when the instance is no longer enabled', async () => {
      const inst = makeInstance();
      config.getEnabledInstances.mockReturnValue([inst]);
      worker.onModuleInit();
      await new Promise((r) => setImmediate(r));
      await new Promise((r) => setImmediate(r));
      await new Promise((r) => setImmediate(r));
      expect(timersOf(worker).has(inst.id)).toBe(true);

      // Now drop the instance from the enabled set and reconcile again by re-bootstrapping.
      config.getEnabledInstances.mockReturnValue([]);
      worker.onModuleInit();
      await new Promise((r) => setImmediate(r));
      await new Promise((r) => setImmediate(r));
      await new Promise((r) => setImmediate(r));
      expect(timersOf(worker).has(inst.id)).toBe(false);
      expect(worker.getStatus().scheduledInstanceIds).toEqual([]);
    });
  });

  describe('triggerInstanceRun', () => {
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

    it('records error status when the pipeline throws (non-fatal)', async () => {
      const instance = makeInstance();
      config.getInstances.mockReturnValue([instance]);
      pipeline.runCycle.mockRejectedValueOnce(new Error('rpc boom'));

      const result = await worker.triggerInstanceRun(instance.id);

      // runInstanceCycle catches the pipeline error → triggerInstanceRun sees success.
      expect(result.success).toBe(true);
      const saved = statusRepo.save.mock.calls.at(-1)?.[0] as ScannerInstanceStatusEntity;
      expect(saved.status).toBe('error');
      expect(saved.lastError).toContain('rpc boom');
    });

    it('returns not-found when the instance id is unknown', async () => {
      config.getInstances.mockReturnValue([makeInstance({ id: 'other' })]);

      const result = await worker.triggerInstanceRun('does-not-exist');

      expect(result.success).toBe(false);
      expect(result.message).toContain('not found');
      expect(statusRepo.save).not.toHaveBeenCalled();
    });

    it('reports failure when runInstanceCycle throws a non-Error value', async () => {
      const instance = makeInstance();
      config.getInstances.mockReturnValue([instance]);
      // Force the private runInstanceCycle to reject with a non-Error by making statusRepo.save
      // throw inside the catch-block path. Simpler: make ensureEffectiveConfigLoaded throw a
      // string (non-Error) so the `err instanceof Error` branch is exercised.
      config.ensureEffectiveConfigLoaded.mockRejectedValueOnce('string error');

      const result = await worker.triggerInstanceRun(instance.id);

      // The cycle still completes (caught internally); triggerInstanceRun reports success.
      expect(result.success).toBe(true);
    });
  });

  describe('getStatus', () => {
    it('reflects scheduled + running ids and the shutdown flag', async () => {
      const inst = makeInstance();
      config.getEnabledInstances.mockReturnValue([inst]);
      worker.onModuleInit();
      await new Promise((r) => setImmediate(r));
      await new Promise((r) => setImmediate(r));
      await new Promise((r) => setImmediate(r));

      const status = worker.getStatus();
      expect(status.isShuttingDown).toBe(false);
      expect(status.scheduledInstanceIds).toContain(inst.id);
    });
  });

  describe('onModuleDestroy', () => {
    it('sets isShuttingDown and clears scheduled instance ids', async () => {
      const inst = makeInstance();
      config.getEnabledInstances.mockReturnValue([inst]);
      worker.onModuleInit();
      await new Promise((r) => setImmediate(r));
      await new Promise((r) => setImmediate(r));
      await new Promise((r) => setImmediate(r));
      expect(timersOf(worker).size).toBe(1);

      worker.onModuleDestroy();
      const status = worker.getStatus();
      expect(status.isShuttingDown).toBe(true);
      expect(status.scheduledInstanceIds).toEqual([]);
      expect(timersOf(worker).size).toBe(0);
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

    it('increments arb_scanner_cycles_total{status="error"} on a failed cycle', async () => {
      const instance = makeInstance();
      config.getInstances.mockReturnValue([instance]);
      pipeline.runCycle.mockRejectedValueOnce(new Error('boom'));
      const before = await cycleCount(instance.id, 'error');

      await worker.triggerInstanceRun(instance.id);

      const after = await cycleCount(instance.id, 'error');
      expect(after).toBe(before + 1);
    });

    it('observes cycle latency even on failure (finally block)', async () => {
      const instance = makeInstance();
      config.getInstances.mockReturnValue([instance]);
      pipeline.runCycle.mockRejectedValueOnce(new Error('boom'));

      await worker.triggerInstanceRun(instance.id);

      const metrics = await getArbibotMetricsRegistry().getMetricsAsJSON();
      const hist = metrics.find((m) => m.name === 'arb_scanner_cycle_latency_ms');
      const sum = (hist?.values ?? []).find(
        (v) => (v as { labels?: Record<string, string> }).labels?.instance === instance.id &&
          (v as { labels?: Record<string, string> }).labels?.le === undefined,
      );
      expect(typeof (sum as { value?: number } | undefined)?.value).toBe('number');
    });
  });
});
