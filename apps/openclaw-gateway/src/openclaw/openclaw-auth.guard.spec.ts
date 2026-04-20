import type { ExecutionContext } from '@nestjs/common';
import { UnauthorizedException } from '@nestjs/common';

import { OpenclawAuthGuard } from './openclaw-auth.guard';

describe('OpenclawAuthGuard', () => {
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
    process.env.OPENCLAW_API_KEYS = 'alpha,beta';
    const guard = new OpenclawAuthGuard();
    expect(
      guard.canActivate(ctx({ 'x-openclaw-api-key': 'beta' })),
    ).toBe(true);
  });

  it('rejects when OPENCLAW_API_KEYS empty', () => {
    process.env.OPENCLAW_API_KEYS = '';
    const guard = new OpenclawAuthGuard();
    expect(() =>
      guard.canActivate(ctx({ 'x-openclaw-api-key': 'x' })),
    ).toThrow(UnauthorizedException);
  });

  it('rejects when header missing', () => {
    process.env.OPENCLAW_API_KEYS = 'secret';
    const guard = new OpenclawAuthGuard();
    expect(() => guard.canActivate(ctx({}))).toThrow(UnauthorizedException);
  });
});
