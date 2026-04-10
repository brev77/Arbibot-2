export type OperatorRole = 'viewer' | 'operator' | 'admin';

const ROLE_RANK: Record<OperatorRole, number> = {
  viewer: 0,
  operator: 1,
  admin: 2,
};

export function normalizeRole(value: string | undefined): OperatorRole | null {
  if (value === 'viewer' || value === 'operator' || value === 'admin') {
    return value;
  }
  return null;
}

export function roleMeetsMinimum(role: OperatorRole, minimum: OperatorRole): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[minimum];
}

/** Minimum role required to access a protected route segment (pathname without query). */
export function minimumRoleForPathname(pathname: string): OperatorRole | null {
  if (pathname.startsWith('/settings') || pathname.startsWith('/openclaw')) {
    return 'admin';
  }
  if (
    pathname.startsWith('/execution') ||
    pathname.startsWith('/tokens') ||
    pathname.startsWith('/paper') ||
    pathname.startsWith('/incidents') ||
    pathname.startsWith('/runbooks')
  ) {
    return 'operator';
  }
  if (
    pathname.startsWith('/dashboard') ||
    pathname.startsWith('/portfolio') ||
    pathname.startsWith('/opportunities')
  ) {
    return 'viewer';
  }
  return null;
}
