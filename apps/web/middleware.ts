import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { SESSION_COOKIE, verifyOperatorSession } from './lib/auth/session';
import {
  minimumRoleForPathname,
  normalizeRole,
  roleMeetsMinimum,
  type OperatorRole,
} from './lib/operator-role';

async function roleFromRequest(
  request: NextRequest,
): Promise<OperatorRole | null> {
  // Signed JWT session — the only trusted session source in production.
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const claims = await verifyOperatorSession(token);
  if (claims !== null) {
    return claims.role;
  }
  // F4: ARBIBOT_DEV_ROLE is a no-op in production (defense-in-depth).
  // Even if the env var is accidentally set in a prod environment, we must not
  // grant a role from it. The signed JWT session is the only source in production.
  if (process.env.NODE_ENV !== 'production') {
    const envRole = normalizeRole(process.env.ARBIBOT_DEV_ROLE);
    if (envRole !== null) {
      return envRole;
    }
    return 'operator';
  }
  return null;
}

function jsonDeny(
  status: 401 | 403,
  code: 'OPERATOR_SESSION_REQUIRED' | 'OPERATOR_INSUFFICIENT_ROLE',
): NextResponse {
  return NextResponse.json(
    { error: status === 401 ? 'Unauthorized' : 'Forbidden', code },
    { status },
  );
}

export async function middleware(
  request: NextRequest,
): Promise<NextResponse> {
  const pathname = request.nextUrl.pathname;
  const minimum = minimumRoleForPathname(pathname);
  if (minimum === null) {
    return NextResponse.next();
  }
  const role = await roleFromRequest(request);
  const isOperatorBff = pathname.startsWith('/api/operator/');
  if (role === null) {
    if (isOperatorBff) {
      return jsonDeny(401, 'OPERATOR_SESSION_REQUIRED');
    }
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('from', pathname);
    return NextResponse.redirect(url);
  }
  if (!roleMeetsMinimum(role, minimum)) {
    if (isOperatorBff) {
      return jsonDeny(403, 'OPERATOR_INSUFFICIENT_ROLE');
    }
    const url = request.nextUrl.clone();
    url.pathname = '/';
    url.searchParams.set('forbidden', '1');
    url.searchParams.set('from', pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: [
    '/api/operator/:path*',
    '/dashboard/:path*',
    '/portfolio/:path*',
    '/opportunities',
    '/opportunities/:path*',
    '/execution/:path*',
    '/tokens',
    '/tokens/:path*',
    '/paper',
    '/paper/:path*',
    '/incidents/:path*',
    '/runbooks/:path*',
    '/hermes/:path*',
    '/settings',
    '/settings/:path*',
  ],
};
