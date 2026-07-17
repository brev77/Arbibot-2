import type { ExecutionContext } from '@nestjs/common';
import { HttpException, HttpStatus } from '@nestjs/common';

import { HermesMutationRateLimitGuard } from './hermes-mutation-rate-limit.guard';
import { HermesRateLimitService } from './hermes-rate-limit.service';

describe('HermesRateLimitService', () => {
  const originalEnv = process.env;
  let service: HermesRateLimitService;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.HERMES_MUTATION_RATE_LIMIT_WINDOW_MS;
    delete process.env.HERMES_MUTATION_RATE_LIMIT_MAX;
    delete process.env.HERMES_MUTATION_RATE_LIMIT_ENABLED;
    service = new HermesRateLimitService();
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe('allow', () => {
    it('allows up to the default max (60) within one window then rejects', () => {
      // First 60 calls allowed in the same window.
      for (let i = 1; i <= 60; i += 1) {
        expect(service.allow('key-A')).toBe(true);
      }
      // 61st call in the same window -> rejected.
      expect(service.allow('key-A')).toBe(false);
    });

    it('tracks buckets independently per API key', () => {
      for (let i = 1; i <= 60; i += 1) service.allow('A');
      expect(service.allow('A')).toBe(false);
      // Different key has its own fresh bucket.
      expect(service.allow('B')).toBe(true);
    });

    it('resets the bucket after the configured window elapses', () => {
      process.env.HERMES_MUTATION_RATE_LIMIT_WINDOW_MS = '50';
      process.env.HERMES_MUTATION_RATE_LIMIT_MAX = '2';
      const svc = new HermesRateLimitService();

      expect(svc.allow('k')).toBe(true);
      expect(svc.allow('k')).toBe(true);
      expect(svc.allow('k')).toBe(false); // limit reached

      // After the window elapses a new window opens.
      const realNow = Date.now;
      Date.now = () => realNow() + 100;
      try {
        expect(svc.allow('k')).toBe(true);
      } finally {
        Date.now = realNow;
      }
    });

    it('respects HERMES_MUTATION_RATE_LIMIT_MAX env override (clamped to 10000)', () => {
      process.env.HERMES_MUTATION_RATE_LIMIT_MAX = '3';
      const svc = new HermesRateLimitService();

      expect(svc.allow('k')).toBe(true);
      expect(svc.allow('k')).toBe(true);
      expect(svc.allow('k')).toBe(true);
      expect(svc.allow('k')).toBe(false);
    });

    it('respects HERMES_MUTATION_RATE_LIMIT_WINDOW_MS override (clamped to 3600000)', () => {
      process.env.HERMES_MUTATION_RATE_LIMIT_WINDOW_MS = '100';
      process.env.HERMES_MUTATION_RATE_LIMIT_MAX = '1';
      const svc = new HermesRateLimitService();

      expect(svc.allow('k')).toBe(true);
      expect(svc.allow('k')).toBe(false); // window still open
    });

    it('returns true unconditionally when HERMES_MUTATION_RATE_LIMIT_ENABLED=false', () => {
      process.env.HERMES_MUTATION_RATE_LIMIT_MAX = '1';
      process.env.HERMES_MUTATION_RATE_LIMIT_ENABLED = 'false';
      const svc = new HermesRateLimitService();

      // Even after exceeding, disabled -> always allow.
      for (let i = 0; i < 100; i += 1) {
        expect(svc.allow('k')).toBe(true);
      }
    });

    it('falls back to defaults when env values are invalid (non-positive / non-numeric)', () => {
      process.env.HERMES_MUTATION_RATE_LIMIT_WINDOW_MS = 'not-a-number';
      process.env.HERMES_MUTATION_RATE_LIMIT_MAX = '-5';
      const svc = new HermesRateLimitService();

      // Defaults apply (max=60).
      for (let i = 1; i <= 60; i += 1) expect(svc.allow('k')).toBe(true);
      expect(svc.allow('k')).toBe(false);
    });
  });
});

describe('HermesMutationRateLimitGuard', () => {
  let limiter: { allow: jest.Mock };
  let guard: HermesMutationRateLimitGuard;

  beforeEach(() => {
    limiter = { allow: jest.fn().mockReturnValue(true) };
    guard = new HermesMutationRateLimitGuard(
      limiter as unknown as HermesRateLimitService,
    );
  });

  function ctx(headers: Record<string, string | string[] | undefined>) {
    return {
      switchToHttp: () => ({ getRequest: () => ({ headers }) }),
    } as ExecutionContext;
  }

  it('allows and buckets by the x-hermes-api-key string header', () => {
    expect(guard.canActivate(ctx({ 'x-hermes-api-key': 'secret-key' }))).toBe(
      true,
    );
    expect(limiter.allow).toHaveBeenCalledWith('secret-key');
  });

  it('uses the first value when the header is an array', () => {
    expect(
      guard.canActivate(ctx({ 'x-hermes-api-key': ['first', 'second'] })),
    ).toBe(true);
    expect(limiter.allow).toHaveBeenCalledWith('first');
  });

  it('buckets as "anonymous" when the header is missing or empty', () => {
    guard.canActivate(ctx({}));
    expect(limiter.allow).toHaveBeenLastCalledWith('anonymous');

    guard.canActivate(ctx({ 'x-hermes-api-key': '' }));
    expect(limiter.allow).toHaveBeenLastCalledWith('anonymous');
  });

  it('throws 429 HttpException when limiter rejects', () => {
    limiter.allow.mockReturnValue(false);

    expect(() =>
      guard.canActivate(ctx({ 'x-hermes-api-key': 'k' })),
    ).toThrow(HttpException);
    try {
      guard.canActivate(ctx({ 'x-hermes-api-key': 'k' }));
    } catch (e) {
      expect((e as HttpException).getStatus()).toBe(
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  });
});
