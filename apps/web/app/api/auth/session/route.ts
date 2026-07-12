import { NextRequest, NextResponse } from 'next/server';

import {
  SESSION_COOKIE,
  clearSessionCookieOptions,
  getBootstrapToken,
  safeEqualStrings,
  sessionCookieOptions,
  signOperatorSession,
} from '@/lib/auth/session';
import { normalizeRole, type OperatorRole } from '@/lib/operator-role';

/**
 * `POST /api/auth/session` — issue a signed operator session.
 *
 * Verifies `OPERATOR_BOOTSTRAP_TOKEN` against the request body (constant-time),
 * then signs a JWT session cookie. In production, a missing
 * `OPERATOR_BOOTSTRAP_TOKEN` env is fail-closed (503). In non-production a dev
 * fallback token (`dev-bootstrap-token`) keeps local development working.
 *
 * Body: `{ bootstrapToken: string, role?: 'viewer'|'operator'|'admin', operatorId?: string }`
 */
export async function POST(
  request: NextRequest,
): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: 'Invalid JSON body' },
      { status: 400 },
    );
  }

  if (typeof body !== 'object' || body === null) {
    return NextResponse.json(
      { error: 'Body must be a JSON object' },
      { status: 400 },
    );
  }

  const { bootstrapToken, role, operatorId } = body as {
    bootstrapToken?: unknown;
    role?: unknown;
    operatorId?: unknown;
  };

  if (typeof bootstrapToken !== 'string' || bootstrapToken.length === 0) {
    return NextResponse.json(
      { error: 'bootstrapToken is required' },
      { status: 400 },
    );
  }

  const expectedToken = getBootstrapToken();
  if (expectedToken === null) {
    // Production without OPERATOR_BOOTSTRAP_TOKEN configured — fail-closed.
    return NextResponse.json(
      { error: 'Session issuance is not configured' },
      { status: 503 },
    );
  }

  if (!safeEqualStrings(bootstrapToken, expectedToken)) {
    return NextResponse.json(
      { error: 'Invalid bootstrap token' },
      { status: 401 },
    );
  }

  // Resolve role: default 'operator', clamp to 'admin' max, reject unknown.
  let resolvedRole: OperatorRole = 'operator';
  if (role !== undefined) {
    const normalized = normalizeRole(
      typeof role === 'string' ? role : undefined,
    );
    if (normalized === null) {
      return NextResponse.json(
        { error: 'Invalid role; must be viewer, operator, or admin' },
        { status: 400 },
      );
    }
    resolvedRole = normalized;
  }

  // Resolve operator identity. Accept a caller-supplied id only if it is a
  // safe non-empty string; otherwise mint a stable random id.
  let sub: string;
  if (
    typeof operatorId === 'string' &&
    operatorId.trim().length > 0 &&
    operatorId.length <= 128
  ) {
    sub = operatorId.trim();
  } else {
    sub = `operator-${crypto.randomUUID()}`;
  }

  try {
    const jwt = await signOperatorSession({ sub, role: resolvedRole });
    const response = NextResponse.json({
      ok: true,
      role: resolvedRole,
      operatorId: sub,
    });
    response.cookies.set(SESSION_COOKIE, jwt, sessionCookieOptions());
    return response;
  } catch (error) {
    // getSessionSecret() throws in prod without OPERATOR_SESSION_SECRET.
    console.error('Failed to sign operator session:', error);
    return NextResponse.json(
      { error: 'Session signing failed' },
      { status: 503 },
    );
  }
}

/**
 * `DELETE /api/auth/session` — revoke (logout). Clears the session cookie.
 */
export function DELETE(): NextResponse {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, '', {
    ...clearSessionCookieOptions(),
    maxAge: 0,
  });
  return response;
}
