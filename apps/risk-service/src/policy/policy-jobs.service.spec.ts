import type { IAuditClient } from '@arbibot/nest-platform';

import { PolicyJobsService } from './policy-jobs.service';
import type { RouteScoringWriterService } from './route-scoring-writer.service';
import type { WatchlistTieringWriterService } from './watchlist-tiering-writer.service';

describe('PolicyJobsService', () => {
  it('runWatchlistTiering invokes writer and audit', async () => {
    const runCycle = jest
      .fn()
      .mockResolvedValue({ instrumentsEvaluated: 2, snapshotsWritten: 1 });
    const watchlistWriter = {
      runCycle,
    } as unknown as WatchlistTieringWriterService;
    const routeWriter = {
      runCycle: jest.fn(),
    } as unknown as RouteScoringWriterService;
    const record = jest.fn();
    const audit = {
      record,
      appendEntry: jest.fn(),
    } as unknown as IAuditClient;
    const svc = new PolicyJobsService(watchlistWriter, routeWriter, audit);
    const out = await svc.runWatchlistTiering('http');
    expect(out.instrumentsEvaluated).toBe(2);
    expect(runCycle).toHaveBeenCalledTimes(1);
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: 'risk-service',
        action: 'WatchlistTieringJob',
        payload: expect.objectContaining({ trigger: 'http' }),
      }),
    );
  });

  it('runRouteScoring invokes writer and audit', async () => {
    const watchlistWriter = {
      runCycle: jest.fn(),
    } as unknown as WatchlistTieringWriterService;
    const routeRunCycle = jest
      .fn()
      .mockResolvedValue({ routesEvaluated: 3, rowsWritten: 0 });
    const routeWriter = {
      runCycle: routeRunCycle,
    } as unknown as RouteScoringWriterService;
    const record = jest.fn();
    const audit = {
      record,
      appendEntry: jest.fn(),
    } as unknown as IAuditClient;
    const svc = new PolicyJobsService(watchlistWriter, routeWriter, audit);
    const out = await svc.runRouteScoring('http');
    expect(out.routesEvaluated).toBe(3);
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'RouteScoringJob',
      }),
    );
  });
});
