import { ServiceUnavailableException } from '@nestjs/common';

import { CapitalLimitsService } from './capital-limits.service';

/**
 * D4-B-3-CEILING — CapitalLimitsService config-reader + fail-closed behaviour.
 * Mirrors the DexRiskPolicyService config-reader test shape.
 */
describe('CapitalLimitsService', () => {
  let service: CapitalLimitsService;
  const originalFetch = global.fetch;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.CAPITAL_MAX_ACTIVE_USD;
    delete process.env.NODE_ENV;

    (global.fetch as unknown) = jest.fn(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            configValue: JSON.stringify({
              maxActiveCapitalUsd: 1000,
              maxDailyNotionalUsd: 10000,
            }),
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      ),
    );

    service = new CapitalLimitsService();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    global.fetch = originalFetch;
  });

  it('parses capital.limits effective and returns the ceiling', async () => {
    expect(await service.getMaxActiveCapitalUsd()).toBe(1000);
  });

  it('retains stale cache on fetch failure', async () => {
    await service.getMaxActiveCapitalUsd(); // populates cache
    (global.fetch as unknown) = jest.fn(() => Promise.reject(new Error('down')));
    expect(await service.getMaxActiveCapitalUsd()).toBe(1000);
  });

  it('env CAPITAL_MAX_ACTIVE_USD tightens the config ceiling (min wins)', async () => {
    process.env.CAPITAL_MAX_ACTIVE_USD = '300';
    expect(await service.getMaxActiveCapitalUsd()).toBe(300);
  });

  it('env looser than config does NOT loosen (config 1000 wins)', async () => {
    process.env.CAPITAL_MAX_ACTIVE_USD = '5000';
    expect(await service.getMaxActiveCapitalUsd()).toBe(1000);
  });

  it('uses env alone when config-service is unreachable (and no cache)', async () => {
    (global.fetch as unknown) = jest.fn(() => Promise.reject(new Error('ECONNREFUSED')));
    process.env.CAPITAL_MAX_ACTIVE_USD = '750';
    const fresh = new CapitalLimitsService();
    expect(await fresh.getMaxActiveCapitalUsd()).toBe(750);
  });

  it('fail-closed in production when neither config nor env resolves', async () => {
    (global.fetch as unknown) = jest.fn(() => Promise.reject(new Error('down')));
    process.env.NODE_ENV = 'production';
    const fresh = new CapitalLimitsService();
    await expect(fresh.getMaxActiveCapitalUsd()).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('non-prod safe default when neither config nor env resolves', async () => {
    (global.fetch as unknown) = jest.fn(() => Promise.reject(new Error('down')));
    const fresh = new CapitalLimitsService();
    expect(await fresh.getMaxActiveCapitalUsd()).toBe(1000);
  });

  it('ignores non-positive / malformed maxActiveCapitalUsd in config', async () => {
    (global.fetch as unknown) = jest.fn(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({ configValue: JSON.stringify({ maxActiveCapitalUsd: -5 }) }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      ),
    );
    process.env.CAPITAL_MAX_ACTIVE_USD = '200';
    const fresh = new CapitalLimitsService();
    expect(await fresh.getMaxActiveCapitalUsd()).toBe(200);
  });
});
