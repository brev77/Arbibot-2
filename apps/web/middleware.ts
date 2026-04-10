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

export function middleware(request: NextRequest): NextResponse {
  const pathname = request.nextUrl.pathname;
  const minimum = minimumRoleForPathname(pathname);
  if (minimum === null) {
    return NextResponse.next();
  }
  const role = roleFromRequest(request);
  if (role === null) {
    const url = request.nextUrl.clone();
    url.pathname = '/';
    url.searchParams.set('forbidden', '1');
    return NextResponse.redirect(url);
  }
  if (!roleMeetsMinimum(role, minimum)) {
    const url = request.nextUrl.clone();
    url.pathname = '/';
    url.searchParams.set('forbidden', '1');
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: [
    '/dashboard/:path*',
    '/portfolio/:path*',
    '/opportunities',
    '/opportunities/:path*',
    '/execution/:path*',
    '/tokens/:path*',
    '/paper/:path*',
    '/incidents/:path*',
    '/runbooks/:path*',
    '/openclaw/:path*',
    '/settings/:path*',
  ],
};
