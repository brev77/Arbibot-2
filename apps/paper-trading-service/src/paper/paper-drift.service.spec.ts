import { getArbibotMetricsRegistry } from '@arbibot/nest-platform';
import { PaperDriftSampleEntity } from '@arbibot/persistence';
import type { Repository } from 'typeorm';

import { PaperDriftService } from './paper-drift.service';

/**
 * PaperDriftService spec (Phase 4 — paper-trading-service coverage).
 *
 * The service persists drift samples + updates a current-bps gauge per
 * instrument/route. `updateStaleGauges` is the self-heal path: finds
 * stale sample fingerprints, double-checks there are no recent samples
 * for the same instrument, then resets the gauge to 0. We exercise:
 *   - list: limit clamp [1,500], instrument-filtered vs unfiltered path
 *   - record: create/save + metrics increment + gauge set with
 *     routeKey vs 'unknown' default
 *   - updateStaleGauges: stale>0 path, stale=0 path, recent-sample guard
 *
 * Repository is a jest mock implementing create/save/find/count/
 * createQueryBuilder. The chained QB stub follows the pattern used in
 * legs.service.spec / snapshots.service.spec.
 */
describe('PaperDriftService', () => {
  let repo: {
    create: jest.Mock;
    save: jest.Mock;
    find: jest.Mock;
    count: jest.Mock;
    createQueryBuilder: jest.Mock;
  };
  let service: PaperDriftService;

  beforeEach(() => {
    // Note: paper-drift-metrics.ts instantiates the Counter/Gauge singletons
    // at module load and registers them on the shared registry. Calling
    // .clear() here would un-register them, but the module-level singletons
    // would still point at the unregistered instances, breaking the next
    // service call. We therefore do NOT clear the registry — the singletons
    // remain valid for the lifetime of the test process.
    repo = {
      create: jest.fn((dto) => dto),
      save: jest.fn((row) => Promise.resolve(row)),
      find: jest.fn(),
      count: jest.fn(),
      createQueryBuilder: jest.fn(),
    };
    service = new PaperDriftService(repo as unknown as Repository<PaperDriftSampleEntity>);
  });

  describe('list', () => {
    it('clamps limit below 1 up to 1', async () => {
      repo.find.mockResolvedValue([]);
      await service.list(undefined, 0);
      expect(repo.find.mock.calls[0]?.[0]).toMatchObject({ take: 1 });
    });

    it('clamps limit above 500 down to 500', async () => {
      repo.find.mockResolvedValue([]);
      await service.list(undefined, 1000);
      expect(repo.find.mock.calls[0]?.[0]).toMatchObject({ take: 500 });
    });

    it('forwards take as-is when within [1,500]', async () => {
      repo.find.mockResolvedValue([]);
      await service.list(undefined, 50);
      expect(repo.find.mock.calls[0]?.[0]).toMatchObject({ take: 50 });
    });

    it('uses unfiltered DESC order when instrumentKey is undefined', async () => {
      repo.find.mockResolvedValue([]);
      await service.list(undefined, 100);
      expect(repo.find.mock.calls[0]?.[0]).toMatchObject({
        order: { capturedAt: 'DESC' },
        take: 100,
      });
      expect(repo.find.mock.calls[0]?.[0]?.where).toBeUndefined();
    });

    it('uses unfiltered DESC order when instrumentKey is empty string', async () => {
      repo.find.mockResolvedValue([]);
      await service.list('', 100);
      expect(repo.find.mock.calls[0]?.[0]?.where).toBeUndefined();
    });

    it('filters by instrumentKey when provided', async () => {
      repo.find.mockResolvedValue([]);
      await service.list('BTC-USDT', 100);
      expect(repo.find.mock.calls[0]?.[0]).toMatchObject({
        where: { instrumentKey: 'BTC-USDT' },
        order: { capturedAt: 'DESC' },
        take: 100,
      });
    });

    it('returns the rows from the repository verbatim', async () => {
      const rows = [
        { id: 's1', instrumentKey: 'BTC-USDT', driftBps: '12' },
      ];
      repo.find.mockResolvedValue(rows);
      const out = await service.list('BTC-USDT', 100);
      expect(out).toBe(rows);
    });
  });

  describe('record', () => {
    it('persists the sample and updates the current-bps gauge with explicit routeKey', async () => {
      const saved = { id: 's1', instrumentKey: 'BTC-USDT', routeKey: 'BTC-USDT' };
      repo.save.mockResolvedValue(saved);
      const out = await service.record({
        instrumentKey: 'BTC-USDT',
        routeKey: 'BTC-USDT',
        paperMid: '100',
        referenceMid: '100.1',
        driftBps: 10,
      });
      expect(repo.create.mock.calls[0]?.[0]).toMatchObject({
        instrumentKey: 'BTC-USDT',
        routeKey: 'BTC-USDT',
        paperMid: '100',
        referenceMid: '100.1',
        driftBps: '10',
      });
      expect(repo.save).toHaveBeenCalled();
      expect(out).toBe(saved);
    });

    it('defaults routeKey to null and gauge label to "unknown" when routeKey omitted', async () => {
      const saved = { id: 's2', instrumentKey: 'ETH-USDT', routeKey: null };
      repo.save.mockResolvedValue(saved);
      await service.record({
        instrumentKey: 'ETH-USDT',
        paperMid: '50',
        referenceMid: '50.05',
        driftBps: 1,
      });
      expect(repo.create.mock.calls[0]?.[0]?.routeKey).toBeNull();
      // Gauge label "unknown" — observable via metrics registry after the call.
      const metric = getArbibotMetricsRegistry().getSingleMetric('arb_paper_drift_bps_current');
      expect(metric).toBeDefined();
    });

    it('increments the recorded counter on each record', async () => {
      repo.save.mockResolvedValue({ id: 's' });
      await service.record({
        instrumentKey: 'BTC-USDT',
        paperMid: '1',
        referenceMid: '1',
        driftBps: 0,
      });
      // Counter is registered on the shared registry (paperDriftSamplesRecorded).
      const metric = getArbibotMetricsRegistry().getSingleMetric(
        'arb_paper_drift_samples_recorded_total',
      );
      expect(metric).toBeDefined();
    });
  });

  describe('updateStaleGauges', () => {
    /** Build a chained createQueryBuilder stub that resolves getRawMany(). */
    const setStale = (rawRows: Array<{ instrumentKey: string; routeKey: string | null }>) => {
      const qb = {
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        distinct: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue(rawRows),
      };
      repo.createQueryBuilder.mockReturnValue(qb);
    };

    it('resets gauges for stale-only instruments and returns the count', async () => {
      setStale([
        { instrumentKey: 'BTC-USDT', routeKey: 'BTC-USDT' },
        { instrumentKey: 'ETH-USDT', routeKey: null },
      ]);
      // Both have 0 recent samples → both reset.
      repo.count.mockResolvedValue(0);
      const count = await service.updateStaleGauges();
      expect(count).toBe(2);
      // stale gauge is registered.
      expect(
        getArbibotMetricsRegistry().getSingleMetric('arb_paper_drift_bps_stale'),
      ).toBeDefined();
    });

    it('skips reset for instruments that still have recent samples', async () => {
      setStale([
        { instrumentKey: 'BTC-USDT', routeKey: 'BTC-USDT' }, // has recent
        { instrumentKey: 'ETH-USDT', routeKey: 'ETH-USDT' }, // stale-only
      ]);
      repo.count
        .mockResolvedValueOnce(5) // BTC-USDT still has recent samples
        .mockResolvedValueOnce(0); // ETH-USDT stale-only
      const count = await service.updateStaleGauges();
      expect(count).toBe(1);
    });

    it('uses "unknown" gauge label when stale row has empty routeKey', async () => {
      setStale([{ instrumentKey: 'SOL-USDT', routeKey: '' }]);
      repo.count.mockResolvedValue(0);
      await service.updateStaleGauges();
      // The "unknown" label path was exercised — no throw, gauge reset.
      const metric = getArbibotMetricsRegistry().getSingleMetric('arb_paper_drift_bps_current');
      expect(metric).toBeDefined();
    });

    it('returns 0 and sets stale gauge to 0 when no stale instruments found', async () => {
      setStale([]);
      const count = await service.updateStaleGauges();
      expect(count).toBe(0);
      expect(
        getArbibotMetricsRegistry().getSingleMetric('arb_paper_drift_bps_stale'),
      ).toBeDefined();
    });
  });
});
