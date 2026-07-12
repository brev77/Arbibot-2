import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { signOperatorSession, SESSION_COOKIE } from '@/lib/auth/session';

import { middleware } from './middleware';

const TEST_SECRET = 'test-session-secret-32-bytes-long-aaaaa';

/**
 * Build a minimal NextRequest-shaped object for middleware tests. The middleware
 * reads `request.nextUrl.pathname`, `request.nextUrl.searchParams`,
 * `request.nextUrl.clone()`, and `request.cookies.get(name)?.value`.
 *
 * `clone()` returns a real `URL` (as NextURL does) so `NextResponse.redirect`
 * accepts it and `pathname`/`searchParams` stay mutable.
 */
function buildRequest(
  pathname: string,
  cookies: Record<string, string> = {},
): Parameters<typeof middleware>[0] {
  const url = new URL(pathname, 'http://localhost');
  return {
    cookies: {
      get: (name: string) => {
        const value = cookies[name];
        return value === undefined ? undefined : { value };
      },
    },
    nextUrl: {
      pathname: url.pathname,
      searchParams: url.searchParams,
      clone() {
        return new URL(url.toString());
      },
    },
  } as Parameters<typeof middleware>[0];
}

describe('middleware — signed session gating', () => {
  beforeEach(() => {
    process.env.NODE_ENV = 'production';
    process.env.OPERATOR_SESSION_SECRET = TEST_SECRET;
    delete process.env.ARBIBOT_DEV_ROLE;
  });

  afterEach(() => {
    delete process.env.OPERATOR_SESSION_SECRET;
    delete process.env.ARBIBOT_DEV_ROLE;
  });

  it('returns 401 OPERATOR_SESSION_REQUIRED for /api/operator/* with no session', async () => {
    const res = await middleware(buildRequest('/api/operator/opportunities'));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.code).toBe('OPERATOR_SESSION_REQUIRED');
  });

  it('redirects to /login for a protected page with no session', async () => {
    const res = await middleware(buildRequest('/dashboard'));
    expect(res.status).toBe(307);
    const location = res.headers.get('location') ?? '';
    expect(location).toContain('/login');
    expect(location).toContain('from=%2Fdashboard');
  });

  it('returns 403 OPERATOR_INSUFFICIENT_ROLE when role is below minimum', async () => {
    const jwt = await signOperatorSession({ sub: 'op-1', role: 'viewer' });
    // /api/operator/settings/* requires admin (via minimumRoleForPathname -> /settings -> admin)
    const res = await middleware(
      buildRequest('/api/operator/settings/configurations', {
        [SESSION_COOKIE]: jwt,
      }),
    );
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.code).toBe('OPERATOR_INSUFFICIENT_ROLE');
  });

  it('allows an admin session through to /settings', async () => {
    const jwt = await signOperatorSession({ sub: 'op-1', role: 'admin' });
    const res = await middleware(
      buildRequest('/settings', { [SESSION_COOKIE]: jwt }),
    );
    expect(res.status).toBe(200);
  });

  it('allows a viewer session through to /dashboard (viewer minimum)', async () => {
    const jwt = await signOperatorSession({ sub: 'op-1', role: 'viewer' });
    const res = await middleware(
      buildRequest('/dashboard', { [SESSION_COOKIE]: jwt }),
    );
    expect(res.status).toBe(200);
  });

  it('a forged arbibot_role=admin cookie does NOT grant admin access (P1 acceptance)', async () => {
    // Only the unsigned cookie is set — no signed arbibot_session. The forged
    // role must not bypass verification.
    const res = await middleware(
      buildRequest('/api/operator/opportunities', { arbibot_role: 'admin' }),
    );
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.code).toBe('OPERATOR_SESSION_REQUIRED');
  });

  it('passes through unprotected paths (e.g. /login) without a session', async () => {
    const res = await middleware(buildRequest('/login'));
    expect(res.status).toBe(200);
  });

  it('returns 401 for an invalid (garbage) session cookie on /api/operator/*', async () => {
    const res = await middleware(
      buildRequest('/api/operator/opportunities', {
        [SESSION_COOKIE]: 'garbage.not-a-jwt',
      }),
    );
    expect(res.status).toBe(401);
  });

  it('returns 401 for a session cookie signed with a different secret', async () => {
    process.env.OPERATOR_SESSION_SECRET = TEST_SECRET;
    const { SignJWT } = await import('jose');
    const forged = await new SignJWT({ role: 'admin' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('op-1')
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(new TextEncoder().encode('other-secret-32-bytes-long-cccccc'));
    const res = await middleware(
      buildRequest('/api/operator/opportunities', {
        [SESSION_COOKIE]: forged,
      }),
    );
    expect(res.status).toBe(401);
  });
});
