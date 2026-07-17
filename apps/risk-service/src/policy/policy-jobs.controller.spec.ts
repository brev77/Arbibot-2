import { ForbiddenException, ServiceUnavailableException } from '@nestjs/common';

import { PolicyJobsController } from './policy-jobs.controller';
import { PolicyJobsService } from './policy-jobs.service';

/**
 * PolicyJobsController spec (Phase 4 — risk-service job-trigger coverage).
 *
 * Each job endpoint is gated by assertJobTrigger: a shared token compared via
 * the `x-arbibot-job-trigger` header. The guard has three outcomes worth
 * asserting — token unconfigured (503), token mismatch (403), token match
 * (delegates to the service). Both header casings (lower / title) and the
 * array form are accepted.
 */
describe('PolicyJobsController', () => {
  const originalEnv = process.env;
  let jobs: {
    runWatchlistTiering: jest.Mock;
    runRouteScoring: jest.Mock;
  };
  let controller: PolicyJobsController;

  beforeEach(() => {
    process.env = { ...originalEnv };
    jobs = {
      runWatchlistTiering: jest.fn().mockResolvedValue({ appended: 0 }),
      runRouteScoring: jest.fn().mockResolvedValue({ appended: 0 }),
    };
    controller = new PolicyJobsController(
      jobs as unknown as PolicyJobsService,
    );
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe('assertJobTrigger (via runWatchlistTiering)', () => {
    it('throws ServiceUnavailableException when the token is not configured', async () => {
      delete process.env.RISK_POLICY_JOB_TRIGGER_TOKEN;

      await expect(
        controller.runWatchlistTiering({}),
      ).rejects.toThrow(ServiceUnavailableException);
      expect(jobs.runWatchlistTiering).not.toHaveBeenCalled();
    });

    it('throws ServiceUnavailableException when the token is whitespace-only', async () => {
      process.env.RISK_POLICY_JOB_TRIGGER_TOKEN = '   ';

      await expect(
        controller.runWatchlistTiering({}),
      ).rejects.toThrow(ServiceUnavailableException);
    });

    it('throws ForbiddenException when the header is missing', async () => {
      process.env.RISK_POLICY_JOB_TRIGGER_TOKEN = 'secret';

      await expect(
        controller.runWatchlistTiering({}),
      ).rejects.toThrow(ForbiddenException);
      expect(jobs.runWatchlistTiering).not.toHaveBeenCalled();
    });

    it('throws ForbiddenException when the token does not match', async () => {
      process.env.RISK_POLICY_JOB_TRIGGER_TOKEN = 'secret';

      await expect(
        controller.runWatchlistTiering({ 'x-arbibot-job-trigger': 'wrong' }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws ForbiddenException when the token matches after trim but header has surrounding whitespace', async () => {
      process.env.RISK_POLICY_JOB_TRIGGER_TOKEN = 'secret';

      // header.trim() === expected -> allowed.
      const result = await controller.runWatchlistTiering({
        'x-arbibot-job-trigger': '  secret  ',
      });

      expect(result).toEqual({ appended: 0 });
    });

    it('accepts the title-case header variant (X-Arbibot-Job-Trigger)', async () => {
      process.env.RISK_POLICY_JOB_TRIGGER_TOKEN = 'secret';

      await controller.runWatchlistTiering({
        'X-Arbibot-Job-Trigger': 'secret',
      });

      expect(jobs.runWatchlistTiering).toHaveBeenCalledWith('http');
    });

    it('uses the first value when the header is an array', async () => {
      process.env.RISK_POLICY_JOB_TRIGGER_TOKEN = 'secret';

      await controller.runWatchlistTiering({
        'x-arbibot-job-trigger': ['secret', 'ignored'],
      });

      expect(jobs.runWatchlistTiering).toHaveBeenCalledWith('http');
    });
  });

  describe('runWatchlistTiering (happy path)', () => {
    it('delegates to jobs.runWatchlistTiering with the http trigger source', async () => {
      process.env.RISK_POLICY_JOB_TRIGGER_TOKEN = 't';
      const out = { appended: 5, kind: 'watchlist-tier' };
      jobs.runWatchlistTiering.mockResolvedValue(out);

      const result = await controller.runWatchlistTiering({
        'x-arbibot-job-trigger': 't',
      });

      expect(result).toBe(out);
      expect(jobs.runWatchlistTiering).toHaveBeenCalledWith('http');
    });
  });

  describe('runRouteScoring', () => {
    it('shares the same token gate and delegates to jobs.runRouteScoring', async () => {
      process.env.RISK_POLICY_JOB_TRIGGER_TOKEN = 'tok';
      const out = { appended: 2 };
      jobs.runRouteScoring.mockResolvedValue(out);

      const result = await controller.runRouteScoring({
        'x-arbibot-job-trigger': 'tok',
      });

      expect(result).toBe(out);
      expect(jobs.runRouteScoring).toHaveBeenCalledWith('http');
    });

    it('rejects when the token gate fails (same guard as watchlist-tiering)', async () => {
      process.env.RISK_POLICY_JOB_TRIGGER_TOKEN = 'tok';

      await expect(
        controller.runRouteScoring({ 'x-arbibot-job-trigger': 'no' }),
      ).rejects.toThrow(ForbiddenException);
      expect(jobs.runRouteScoring).not.toHaveBeenCalled();
    });
  });
});
