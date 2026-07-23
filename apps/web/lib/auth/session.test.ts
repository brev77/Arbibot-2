import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  cookieSecure,
  getSessionSecret,
  safeEqualStrings,
  signOperatorSession,
  verifyOperatorSession,
} from '@/lib/auth/session';

const TEST_SECRET = 'test-session-secret-32-bytes-long-aaaaa';
const OTHER_SECRET = 'other-session-secret-32-bytes-long-bbbbb';

describe('auth/session — sign/verify round-trip', () => {
  beforeEach(() => {
    process.env.NODE_ENV = 'development';
    process.env.OPERATOR_SESSION_SECRET = TEST_SECRET;
    delete process.env.OPERATOR_SESSION_TTL_SECONDS;
  });

  afterEach(() => {
    delete process.env.OPERATOR_SESSION_SECRET;
    delete process.env.OPERATOR_SESSION_TTL_SECONDS;
  });

  it('verifies a freshly signed token and returns claims', async () => {
    const jwt = await signOperatorSession({ sub: 'op-1', role: 'admin' });
    const claims = await verifyOperatorSession(jwt);
    expect(claims).not.toBeNull();
    expect(claims?.sub).toBe('op-1');
    expect(claims?.role).toBe('admin');
  });

  it('returns null for an expired token', async () => {
    process.env.OPERATOR_SESSION_TTL_SECONDS = '1';
    const jwt = await signOperatorSession({ sub: 'op-1', role: 'operator' });
    // wait just over 1s for expiry
    await new Promise((r) => setTimeout(r, 1200));
    const claims = await verifyOperatorSession(jwt);
    expect(claims).toBeNull();
  });

  it('returns null for a token signed with a different secret', async () => {
    process.env.OPERATOR_SESSION_SECRET = TEST_SECRET;
    const jwt = await signOperatorSession({ sub: 'op-1', role: 'admin' });
    process.env.OPERATOR_SESSION_SECRET = OTHER_SECRET;
    const claims = await verifyOperatorSession(jwt);
    expect(claims).toBeNull();
  });

  it('returns null for a tampered token (role claim mutated)', async () => {
    const jwt = await signOperatorSession({ sub: 'op-1', role: 'viewer' });
    // Tamper: flip a character in the payload section. A valid JWT has three
    // base64url parts separated by dots; mutating the payload breaks the signature.
    const parts = jwt.split('.');
    // Decode payload, change role viewer -> admin, re-encode (invalid signature).
    const payloadJson = JSON.parse(
      Buffer.from(parts[1]!, 'base64url').toString('utf8'),
    ) as { role: string };
    payloadJson.role = 'admin';
    const tamperedPayload = Buffer
      .from(JSON.stringify(payloadJson), 'utf8')
      .toString('base64url');
    const tampered = `${parts[0]}.${tamperedPayload}.${parts[2]}`;
    const claims = await verifyOperatorSession(tampered);
    expect(claims).toBeNull();
  });

  it('returns null for empty / undefined / null input', async () => {
    expect(await verifyOperatorSession(undefined)).toBeNull();
    expect(await verifyOperatorSession(null)).toBeNull();
    expect(await verifyOperatorSession('')).toBeNull();
    expect(await verifyOperatorSession('not-a-jwt')).toBeNull();
  });

  it('returns null when the role claim is not a known role', async () => {
    // Sign a token with a foreign secret that produces a role='superadmin' claim,
    // then verify with the same secret — role normalization must reject it.
    process.env.OPERATOR_SESSION_SECRET = TEST_SECRET;
    const { SignJWT } = await import('jose');
    const jwt = await new SignJWT({ role: 'superadmin' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('op-1')
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(new TextEncoder().encode(TEST_SECRET));
    const claims = await verifyOperatorSession(jwt);
    expect(claims).toBeNull();
  });
});

describe('auth/session — getSessionSecret fail-closed', () => {
  afterEach(() => {
    process.env.NODE_ENV = 'test';
    delete process.env.OPERATOR_SESSION_SECRET;
  });

  it('throws in production when OPERATOR_SESSION_SECRET is missing', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.OPERATOR_SESSION_SECRET;
    expect(() => getSessionSecret()).toThrow(
      'OPERATOR_SESSION_SECRET environment variable is required in production',
    );
  });

  it('throws in production when OPERATOR_SESSION_SECRET is empty', () => {
    process.env.NODE_ENV = 'production';
    process.env.OPERATOR_SESSION_SECRET = '';
    expect(() => getSessionSecret()).toThrow();
  });

  it('returns a dev fallback in non-production when the secret is missing', () => {
    process.env.NODE_ENV = 'development';
    delete process.env.OPERATOR_SESSION_SECRET;
    const secret = getSessionSecret();
    expect(typeof secret).toBe('string');
    expect(secret.length).toBeGreaterThanOrEqual(32);
  });

  it('returns the configured secret when set', () => {
    process.env.NODE_ENV = 'production';
    process.env.OPERATOR_SESSION_SECRET = TEST_SECRET;
    expect(getSessionSecret()).toBe(TEST_SECRET);
  });
});

describe('auth/session — cookieSecure (OPERATOR_COOKIE_SECURE override)', () => {
  afterEach(() => {
    delete process.env.OPERATOR_COOKIE_SECURE;
    process.env.NODE_ENV = 'test';
  });

  it('defaults to isProduction() when the env var is unset', () => {
    delete process.env.OPERATOR_COOKIE_SECURE;
    process.env.NODE_ENV = 'production';
    expect(cookieSecure()).toBe(true);
    process.env.NODE_ENV = 'development';
    expect(cookieSecure()).toBe(false);
  });

  it('defaults to isProduction() when the env var is empty', () => {
    process.env.OPERATOR_COOKIE_SECURE = '';
    process.env.NODE_ENV = 'production';
    expect(cookieSecure()).toBe(true);
  });

  it('explicit false/0 forces non-secure even in production (paper-HTTP)', () => {
    process.env.NODE_ENV = 'production';
    for (const val of ['false', '0', 'FALSE', 'False', ' 0 ']) {
      process.env.OPERATOR_COOKIE_SECURE = val;
      expect(cookieSecure()).toBe(false);
    }
  });

  it('explicit true/1 forces secure even outside production (TLS-terminated)', () => {
    process.env.NODE_ENV = 'development';
    for (const val of ['true', '1', 'TRUE', 'True', ' 1 ']) {
      process.env.OPERATOR_COOKIE_SECURE = val;
      expect(cookieSecure()).toBe(true);
    }
  });

  it('unrecognized value falls back to the safe default (isProduction)', () => {
    process.env.NODE_ENV = 'production';
    process.env.OPERATOR_COOKIE_SECURE = 'yes';
    expect(cookieSecure()).toBe(true);
    process.env.NODE_ENV = 'development';
    expect(cookieSecure()).toBe(false);
  });
});

describe('auth/session — safeEqualStrings', () => {
  it('returns true for equal strings', () => {
    expect(safeEqualStrings('abc', 'abc')).toBe(true);
  });

  it('returns false for different strings of equal length', () => {
    expect(safeEqualStrings('abc', 'abd')).toBe(false);
  });

  it('returns false for different lengths', () => {
    expect(safeEqualStrings('abc', 'abcd')).toBe(false);
    expect(safeEqualStrings('abcd', 'abc')).toBe(false);
  });

  it('returns true for empty strings', () => {
    expect(safeEqualStrings('', '')).toBe(true);
  });
});
