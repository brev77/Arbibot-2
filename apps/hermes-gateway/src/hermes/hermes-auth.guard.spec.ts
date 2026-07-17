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

  function ctx(
    headers: Record<string, string | string[] | undefined>,
  ): ExecutionContext {
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

  it('allows when the first key matches', () => {
    process.env.HERMES_API_KEYS = 'alpha,beta';
    const guard = new HermesAuthGuard();
    expect(
      guard.canActivate(ctx({ 'x-hermes-api-key': 'alpha' })),
    ).toBe(true);
  });

  it('rejects when API key does not match (timing-safe path)', () => {
    process.env.HERMES_API_KEYS = 'alpha,beta';
    const guard = new HermesAuthGuard();
    expect(() =>
      guard.canActivate(ctx({ 'x-hermes-api-key': 'gamma' })),
    ).toThrow(UnauthorizedException);
  });

  it('rejects when provided key is a prefix of an allowed key (no partial leak)', () => {
    process.env.HERMES_API_KEYS = 'alpha-secret';
    const guard = new HermesAuthGuard();
    expect(() =>
      guard.canActivate(ctx({ 'x-hermes-api-key': 'alpha' })),
    ).toThrow(UnauthorizedException);
  });

  it('rejects when provided key length differs from every allowed key', () => {
    // Exercises the dummy timingSafeEqual branch (lengths differ) — must not
    // throw and must reject without leaking the length mismatch.
    process.env.HERMES_API_KEYS = 'short,longer-key';
    const guard = new HermesAuthGuard();
    expect(() =>
      guard.canActivate(ctx({ 'x-hermes-api-key': 'medium-length-value' })),
    ).toThrow(UnauthorizedException);
  });

  it('rejects when HERMES_API_KEYS empty', () => {
    process.env.HERMES_API_KEYS = '';
    const guard = new HermesAuthGuard();
    expect(() =>
      guard.canActivate(ctx({ 'x-hermes-api-key': 'x' })),
    ).toThrow(UnauthorizedException);
  });

  it('rejects when HERMES_API_KEYS unset', () => {
    delete process.env.HERMES_API_KEYS;
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

  it('rejects when header is empty string', () => {
    process.env.HERMES_API_KEYS = 'secret';
    const guard = new HermesAuthGuard();
    expect(() =>
      guard.canActivate(ctx({ 'x-hermes-api-key': '' })),
    ).toThrow(UnauthorizedException);
  });

  it('uses the first value when header is an array', () => {
    process.env.HERMES_API_KEYS = 'alpha';
    const guard = new HermesAuthGuard();
    expect(
      guard.canActivate(ctx({ 'x-hermes-api-key': ['alpha', 'ignored'] })),
    ).toBe(true);
  });

  it('rejects when header array first value does not match', () => {
    process.env.HERMES_API_KEYS = 'alpha';
    const guard = new HermesAuthGuard();
    expect(() =>
      guard.canActivate(ctx({ 'x-hermes-api-key': ['beta', 'alpha'] })),
    ).toThrow(UnauthorizedException);
  });

  it('trims whitespace when parsing allowed keys', () => {
    process.env.HERMES_API_KEYS = '  alpha ,  beta  ';
    const guard = new HermesAuthGuard();
    expect(
      guard.canActivate(ctx({ 'x-hermes-api-key': 'beta' })),
    ).toBe(true);
  });
});
