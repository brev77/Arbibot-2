import { cookies } from 'next/headers';

export type OperatorRole = 'viewer' | 'operator' | 'admin';

export interface OperatorSession {
  readonly role: OperatorRole;
  readonly source: 'cookie' | 'env' | 'dev-default';
}

function normalizeRole(value: string | undefined): OperatorRole | null {
  if (value === 'viewer' || value === 'operator' || value === 'admin') {
    return value;
  }
  return null;
}

export async function getOperatorSession(): Promise<OperatorSession | null> {
  const cookieStore = await cookies();
  const cookieRole = normalizeRole(cookieStore.get('arbibot_role')?.value);
  if (cookieRole !== null) {
    return { role: cookieRole, source: 'cookie' };
  }

  const envRole = normalizeRole(process.env.ARBIBOT_DEV_ROLE);
  if (envRole !== null) {
    return { role: envRole, source: 'env' };
  }

  if (process.env.NODE_ENV !== 'production') {
    return { role: 'operator', source: 'dev-default' };
  }

  return null;
}
