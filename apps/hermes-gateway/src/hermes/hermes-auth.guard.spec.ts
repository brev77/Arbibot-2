import type { ExecutionContext } from '@nestjs/common';
import { UnauthorizedException } from '@nestjs/common';

import { HermesAuthGuard } from './hermes-auth.guard';

describe('HermesAuthGuard', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  function ctx(headers: Record<string, string | undefined>): ExecutionContext {
    return {
      switchToHttp: () => ({
        getRequest: () => ({ headers }),
      }),
    } as ExecutionContext;
  }

  it('allows when API key matches', () => {
    process.env.HERMES_API_KEYS = 'alpha,beta';
    const guard = new HermesAuthGuard();
    expect(
      guard.canActivate(ctx({ 'x-hermes-api-key': 'beta' })),
    ).toBe(true);
  });

  it('rejects when HERMES_API_KEYS empty', () => {
    process.env.HERMES_API_KEYS = '';
    const guard = new HermesAuthGuard();
    expect(() =>
      guard.canActivate(ctx({ 'x-hermes-api-key': 'x' })),
    ).toThrow(UnauthorizedException);
  });

  it('rejects when header missing', () => {
    process.env.HERMES_API_KEYS = 'secret';
    const guard = new HermesAuthGuard();
    expect(() => guard.canActivate(ctx({}))).toThrow(UnauthorizedException);
  });
});
