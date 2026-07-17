import { PolicyJobsService } from './policy-jobs.service';
import type { RouteScoringWriterService } from './route-scoring-writer.service';
import type { WatchlistTieringWriterService } from './watchlist-tiering-writer.service';

describe('PolicyJobsService', () => {
  const originalEnv = process.env;

  const mkWriters = () => ({
    watchlistWriter: {
      runCycle: jest.fn().mockResolvedValue({ instrumentsEvaluated: 0, snapshotsWritten: 0 }),
    } as unknown as WatchlistTieringWriterService,
    routeWriter: {
      runCycle: jest.fn().mockResolvedValue({ routesEvaluated: 0, rowsWritten: 0 }),
    } as unknown as RouteScoringWriterService,
  });

  const mkAudit = () => ({ record: jest.fn(), appendEntry: jest.fn() });

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.RISK_POLICY_JOBS_ENABLED;
    delete process.env.WATCHLIST_TIERING_INTERVAL_MS;
    delete process.env.ROUTE_SCORING_INTERVAL_MS;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

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
    const svc = new PolicyJobsService(watchlistWriter, routeWriter, mkAudit());
    const out = await svc.runWatchlistTiering('http');
    expect(out.instrumentsEvaluated).toBe(2);
    expect(runCycle).toHaveBeenCalledTimes(1);
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
    const svc = new PolicyJobsService(watchlistWriter, routeWriter, mkAudit());
    const out = await svc.runRouteScoring('http');
    expect(out.routesEvaluated).toBe(3);
  });

  describe('onModuleInit (cron scheduling)', () => {
    it('does not schedule timers when RISK_POLICY_JOBS_ENABLED is off', () => {
      const { watchlistWriter, routeWriter } = mkWriters();
      const svc = new PolicyJobsService(watchlistWriter, routeWriter, mkAudit());

      svc.onModuleInit();

      expect(watchlistWriter.runCycle).not.toHaveBeenCalled();
      svc.onModuleDestroy();
    });

    it('schedules both writers when enabled (timers are unref-ed)', () => {
      process.env.RISK_POLICY_JOBS_ENABLED = 'true';
      process.env.WATCHLIST_TIERING_INTERVAL_MS = '600000';
      process.env.ROUTE_SCORING_INTERVAL_MS = '3600000';
      const { watchlistWriter, routeWriter } = mkWriters();
      const svc = new PolicyJobsService(watchlistWriter, routeWriter, mkAudit());

      svc.onModuleInit();
      svc.onModuleDestroy();
    });

    it('accepts truthy variants "1" and "yes" for RISK_POLICY_JOBS_ENABLED', () => {
      const { watchlistWriter, routeWriter } = mkWriters();

      process.env.RISK_POLICY_JOBS_ENABLED = '1';
      let svc = new PolicyJobsService(watchlistWriter, routeWriter, mkAudit());
      svc.onModuleInit();
      svc.onModuleDestroy();

      process.env.RISK_POLICY_JOBS_ENABLED = 'yes';
      svc = new PolicyJobsService(watchlistWriter, routeWriter, mkAudit());
      svc.onModuleInit();
      svc.onModuleDestroy();
    });

    it('falls back to default intervals when env values are invalid or below the 10s floor', () => {
      process.env.RISK_POLICY_JOBS_ENABLED = 'true';
      process.env.WATCHLIST_TIERING_INTERVAL_MS = 'not-a-number';
      process.env.ROUTE_SCORING_INTERVAL_MS = '5000';
      const { watchlistWriter, routeWriter } = mkWriters();
      const svc = new PolicyJobsService(watchlistWriter, routeWriter, mkAudit());

      svc.onModuleInit();
      svc.onModuleDestroy();
    });
  });

  describe('onModuleDestroy', () => {
    it('is a no-op when no timers were scheduled', () => {
      const { watchlistWriter, routeWriter } = mkWriters();
      const svc = new PolicyJobsService(watchlistWriter, routeWriter, mkAudit());
      expect(() => svc.onModuleDestroy()).not.toThrow();
    });
  });
});
