import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { signOperatorSession, SESSION_COOKIE } from '@/lib/auth/session';

// Mock `next/headers` so `cookies()` returns a controllable store.
const cookieStore = new Map<string, string>();
vi.mock('next/headers', () => ({
  cookies: vi.fn(() => ({
    get: (name: string) => {
      const value = cookieStore.get(name);
      return value === undefined ? undefined : { value };
    },
  })),
}));

// Import after the mock is registered.
const { getOperatorSession } = await import('@/lib/operator-session');

const TEST_SECRET = 'test-session-secret-32-bytes-long-aaaaa';

describe('operator-session — getOperatorSession', () => {
  beforeEach(() => {
    cookieStore.clear();
    process.env.NODE_ENV = 'development';
    process.env.OPERATOR_SESSION_SECRET = TEST_SECRET;
    delete process.env.ARBIBOT_DEV_ROLE;
    delete process.env.ARBIBOT_DEV_OPERATOR_ID;
  });

  afterEach(() => {
    cookieStore.clear();
    delete process.env.OPERATOR_SESSION_SECRET;
    delete process.env.ARBIBOT_DEV_ROLE;
    delete process.env.ARBIBOT_DEV_OPERATOR_ID;
  });

  it('returns the session from a valid signed JWT cookie', async () => {
    const jwt = await signOperatorSession({ sub: 'op-42', role: 'admin' });
    cookieStore.set(SESSION_COOKIE, jwt);
    const session = await getOperatorSession();
    expect(session).not.toBeNull();
    expect(session?.role).toBe('admin');
    expect(session?.operatorId).toBe('op-42');
    expect(session?.source).toBe('jwt');
  });

  it('returns null in production when no valid session cookie is present', async () => {
    process.env.NODE_ENV = 'production';
    // No cookie set, no ARBIBOT_DEV_ROLE in prod.
    const session = await getOperatorSession();
    expect(session).toBeNull();
  });

  it('returns null in production when the cookie is a forged unsigned role', async () => {
    process.env.NODE_ENV = 'production';
    // A plaintext forged "admin" — not a signed JWT — must NOT grant access.
    cookieStore.set('arbibot_role', 'admin');
    const session = await getOperatorSession();
    expect(session).toBeNull();
  });

  it('returns null in production for an invalid JWT cookie', async () => {
    process.env.NODE_ENV = 'production';
    cookieStore.set(SESSION_COOKIE, 'garbage.not-a-jwt');
    const session = await getOperatorSession();
    expect(session).toBeNull();
  });

  it('falls back to ARBIBOT_DEV_ROLE in non-production', async () => {
    process.env.NODE_ENV = 'development';
    process.env.ARBIBOT_DEV_ROLE = 'viewer';
    process.env.ARBIBOT_DEV_OPERATOR_ID = 'dev-op-1';
    const session = await getOperatorSession();
    expect(session).not.toBeNull();
    expect(session?.role).toBe('viewer');
    expect(session?.operatorId).toBe('dev-op-1');
    expect(session?.source).toBe('env');
  });

  it('falls back to dev-default operator role in non-production', async () => {
    process.env.NODE_ENV = 'development';
    const session = await getOperatorSession();
    expect(session).not.toBeNull();
    expect(session?.role).toBe('operator');
    expect(session?.source).toBe('dev-default');
  });

  it('prefers a signed JWT over ARBIBOT_DEV_ROLE in non-production', async () => {
    process.env.NODE_ENV = 'development';
    process.env.ARBIBOT_DEV_ROLE = 'viewer';
    const jwt = await signOperatorSession({ sub: 'op-jwt', role: 'admin' });
    cookieStore.set(SESSION_COOKIE, jwt);
    const session = await getOperatorSession();
    expect(session?.role).toBe('admin');
    expect(session?.operatorId).toBe('op-jwt');
    expect(session?.source).toBe('jwt');
  });
});
