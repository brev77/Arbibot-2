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

export function formatRoleLabel(role: OperatorRole): string {
  switch (role) {
    case 'viewer':
      return 'Viewer';
    case 'operator':
      return 'Operator';
    case 'admin':
      return 'Admin';
  }
}

/**
 * Minimum role for same-origin operator BFF (`/api/operator/*`).
 * Must stay aligned with `(operator)` pages that call each BFF path.
 */
function minimumRoleForOperatorBffPathname(pathname: string): OperatorRole | null {
  if (!pathname.startsWith('/api/operator/')) {
    return null;
  }
  if (pathname.startsWith('/api/operator/opportunities')) {
    return 'viewer';
  }
  if (pathname.startsWith('/api/operator/audit')) {
    return 'viewer';
  }
  if (pathname.startsWith('/api/operator/execution')) {
    return 'operator';
  }
  if (pathname.startsWith('/api/operator/portfolio')) {
    return 'operator';
  }
  if (pathname.startsWith('/api/operator/reconciliation')) {
    return 'operator';
  }
  if (pathname.startsWith('/api/operator/paper')) {
    return 'operator';
  }
  // Phase 5 Hermes: read-only endpoints accessible to viewers; mutations enforced by POST/PATCH handlers.
  if (pathname.startsWith('/api/operator/hermes/v1/')) {
    return 'viewer';
  }
  return 'operator';
}

/** Minimum role required to access a protected route segment (pathname without query). */
export function minimumRoleForPathname(pathname: string): OperatorRole | null {
  const bff = minimumRoleForOperatorBffPathname(pathname);
  if (bff !== null) {
    return bff;
  }
  if (pathname.startsWith('/settings')) {
    return 'admin';
  }
  // Drill #1 gap #2: relax /hermes to viewer for read-only Hermes summary.
  // Mutations remain gated at the BFF level (POST/PATCH → operator role).
  if (pathname.startsWith('/hermes')) {
    return 'viewer';
  }
  if (
    pathname.startsWith('/portfolio') ||
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
    pathname.startsWith('/opportunities')
  ) {
    return 'viewer';
  }
  return null;
}
