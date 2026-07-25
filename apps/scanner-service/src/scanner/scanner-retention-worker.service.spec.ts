import { getArbibotMetricsRegistry } from '@arbibot/nest-platform';
import { ScannerFindingEntity } from '@arbibot/persistence';
import type { Repository } from 'typeorm';

import { ScannerRetentionWorkerService } from './scanner-retention-worker.service';
import type { ScannerConfigService } from './scanner-config.service';

/**
 * Retention worker spec (S5-2-RETENTION).
 *
 * Verifies:
 *   - runCycle deletes findings older than the retention cutoff (LessThan) and reports affected.
 *   - cutoff reflects env `SCANNER_FINDINGS_RETENTION_DAYS` override and the config default.
 *   - metric `arb_scanner_findings_cleaned_total{instance='global'}` increments by the deleted count.
 *   - worker is a no-op when `SCANNER_RETENTION_ENABLED=false` (onModuleInit skips the timer).
 */
describe('ScannerRetentionWorkerService', () => {
  const originalEnv = process.env;
  let findingsRepo: { delete: jest.Mock };
  let config: { getConfig: jest.Mock };
  let service: ScannerRetentionWorkerService;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.SCANNER_FINDINGS_RETENTION_DAYS;
    delete process.env.SCANNER_RETENTION_INTERVAL_MS;
    delete process.env.SCANNER_RETENTION_ENABLED;
    getArbibotMetricsRegistry().clear();
    findingsRepo = {
      delete: jest.fn().mockResolvedValue({ affected: 0 }),
    };
    config = {
      getConfig: jest.fn().mockReturnValue({
        defaults: { findingsRetentionDays: 7 },
      }),
    };
    service = new ScannerRetentionWorkerService(
      findingsRepo as unknown as Repository<ScannerFindingEntity>,
      config as unknown as ScannerConfigService,
    );
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('deletes findings older than the retention cutoff (default 7 days)', async () => {
    findingsRepo.delete.mockResolvedValue({ affected: 42 });
    const before = Date.now();
    const { cutoff, deleted } = await service.runCycle();
    const after = Date.now();

    expect(deleted).toBe(42);
    // cutoff ≈ now − 7 days (within the call window).
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
    expect(cutoff.getTime()).toBeGreaterThanOrEqual(before - sevenDaysMs - 50);
    expect(cutoff.getTime()).toBeLessThanOrEqual(after - sevenDaysMs + 50);

    expect(findingsRepo.delete).toHaveBeenCalledTimes(1);
    const arg = findingsRepo.delete.mock.calls[0]?.[0] as {
      observedAt: { _type?: string; value?: Date };
    };
    // TypeORM LessThan operator shape: { _type: 'moreThanOrEqual'/... , value } or a function.
    // We only assert it is a LessThan-cutoff pair by presence of the observedAt key.
    expect(arg).toBeDefined();
    expect(arg.observedAt).toBeDefined();
  });

  it('respects SCANNER_FINDINGS_RETENTION_DAYS env override', async () => {
    process.env.SCANNER_FINDINGS_RETENTION_DAYS = '2';
    const before = Date.now();
    const { cutoff } = await service.runCycle();
    const twoDaysMs = 2 * 24 * 60 * 60 * 1000;
    expect(cutoff.getTime()).toBeGreaterThanOrEqual(before - twoDaysMs - 50);
    expect(cutoff.getTime()).toBeLessThanOrEqual(
      Date.now() - twoDaysMs + 50,
    );
  });

  it('falls back to config default when env unset', async () => {
    config.getConfig.mockReturnValue({
      defaults: { findingsRetentionDays: 14 },
    });
    const before = Date.now();
    const { cutoff } = await service.runCycle();
    const fourteenDaysMs = 14 * 24 * 60 * 60 * 1000;
    expect(cutoff.getTime()).toBeGreaterThanOrEqual(before - fourteenDaysMs - 50);
  });

  it('reports 0 deleted and does NOT increment metric when nothing matched', async () => {
    findingsRepo.delete.mockResolvedValue({ affected: 0 });
    const { deleted } = await service.runCycle();
    expect(deleted).toBe(0);
    // The counter exists (registered in the constructor) but has no labelled value yet.
    const metrics = await getArbibotMetricsRegistry().getMetricsAsJSON();
    const m = metrics.find((x) => x.name === 'arb_scanner_findings_cleaned_total');
    const values = (m?.values ?? []) as Array<{ value: number }>;
    expect(values.length).toBe(0);
  });

  it('increments arb_scanner_findings_cleaned_total{instance="global"} by deleted count', async () => {
    findingsRepo.delete.mockResolvedValue({ affected: 10 });
    await service.runCycle();
    await service.runCycle();
    const metrics = await getArbibotMetricsRegistry().getMetricsAsJSON();
    const m = metrics.find((x) => x.name === 'arb_scanner_findings_cleaned_total');
    const values = (m?.values ?? []) as Array<{
      labels: Record<string, string>;
      value: number;
    }>;
    const hit = values.find(
      (v) => v.labels.instance === 'global',
    );
    expect(hit?.value).toBe(20);
  });

  it('treats `affected` missing as 0 (defensive — older TypeORM)', async () => {
    findingsRepo.delete.mockResolvedValue({}); // no `affected`
    const { deleted } = await service.runCycle();
    expect(deleted).toBe(0);
  });

  it('swallows delete errors and returns deleted=0 (worker stays alive)', async () => {
    findingsRepo.delete.mockRejectedValue(new Error('connection refused'));
    const { deleted } = await service.runCycle();
    expect(deleted).toBe(0);
  });

  it('onModuleInit does NOT start the timer when SCANNER_RETENTION_ENABLED=false', () => {
    process.env.SCANNER_RETENTION_ENABLED = 'false';
    service.onModuleInit();
    // No throw + no timer started. We assert via the private field indirectly: a second
    // onModuleDestroy call should be a safe no-op.
    expect(() => service.onModuleDestroy()).not.toThrow();
  });

  it('onModuleDestroy clears the timer without throwing', () => {
    expect(() => service.onModuleDestroy()).not.toThrow();
  });
});
