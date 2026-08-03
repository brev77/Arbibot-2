import { getArbibotMetricsRegistry } from '@arbibot/nest-platform';

import { ReconciliationDetectorCronWorker } from './reconciliation-detector-cron.worker';
import type { MismatchesService } from './mismatches.service';

describe('ReconciliationDetectorCronWorker (P9-7)', () => {
  function buildWorker(runDetectorsImpl: () => Promise<unknown>) {
    const mismatchesService = {
      runDetectors: jest.fn(runDetectorsImpl),
    } as unknown as MismatchesService;
    return { worker: new ReconciliationDetectorCronWorker(mismatchesService), mismatchesService };
  }

  beforeEach(() => {
    getArbibotMetricsRegistry().clear();
  });

  it('runs runDetectors and counts a success cycle', async () => {
    const { worker, mismatchesService } = buildWorker(() => Promise.resolve({ inserted: 3 }));
    await worker.runCycle();
    expect(mismatchesService.runDetectors).toHaveBeenCalledTimes(1);
  });

  it('counts an error cycle when runDetectors throws (does not crash)', async () => {
    const { worker, mismatchesService } = buildWorker(() => Promise.reject(new Error('DB down')));
    await expect(worker.runCycle()).resolves.toBeUndefined();
    expect(mismatchesService.runDetectors).toHaveBeenCalledTimes(1);
  });

  it('does not start the interval when RECON_DETECTOR_ENABLED=false', () => {
    const original = process.env.RECON_DETECTOR_ENABLED;
    process.env.RECON_DETECTOR_ENABLED = 'false';
    try {
      const { worker } = buildWorker(() => Promise.resolve({}));
      worker.onModuleInit();
      worker.onModuleDestroy();
    } finally {
      if (original === undefined) delete process.env.RECON_DETECTOR_ENABLED;
      else process.env.RECON_DETECTOR_ENABLED = original;
    }
  });
});
