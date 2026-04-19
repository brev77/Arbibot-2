import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import {
  minimumRoleForPathname,
  normalizeRole,
  roleMeetsMinimum,
  type OperatorRole,
} from './lib/operator-role';

function roleFromRequest(request: NextRequest): OperatorRole | null {
  const cookieRole = normalizeRole(request.cookies.get('arbibot_role')?.value);
  if (cookieRole !== null) {
    return cookieRole;
  }
  const envRole = normalizeRole(process.env.ARBIBOT_DEV_ROLE);
  if (envRole !== null) {
    return envRole;
  }
  if (process.env.NODE_ENV !== 'production') {
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

export function middleware(request: NextRequest): NextResponse {
  const pathname = request.nextUrl.pathname;
  const minimum = minimumRoleForPathname(pathname);
  if (minimum === null) {
    return NextResponse.next();
  }
  const role = roleFromRequest(request);
  const isOperatorBff = pathname.startsWith('/api/operator/');
  if (role === null) {
    if (isOperatorBff) {
      return jsonDeny(401, 'OPERATOR_SESSION_REQUIRED');
    }
    const url = request.nextUrl.clone();
    url.pathname = '/';
    url.searchParams.set('forbidden', '1');
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
    '/openclaw/:path*',
    '/settings',
    '/settings/:path*',
  ],
};
