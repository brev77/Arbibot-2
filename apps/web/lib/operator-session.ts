import { cookies } from 'next/headers';

import { normalizeRole, type OperatorRole } from './operator-role';

export type { OperatorRole };

export interface OperatorSession {
  readonly role: OperatorRole;
  readonly source: 'cookie' | 'env' | 'dev-default';
  /** Stable operator identity for audit / config mutations (BFF forwards to backends). */
  readonly operatorId: string;
}

function resolveOperatorId(cookieStore: Awaited<ReturnType<typeof cookies>>): string {
  const fromCookie = cookieStore.get('arbibot_operator_id')?.value?.trim();
  if (fromCookie && fromCookie.length > 0) {
    return fromCookie;
  }
  const fromEnv = process.env.ARBIBOT_DEV_OPERATOR_ID?.trim();
  if (fromEnv && fromEnv.length > 0) {
    return fromEnv;
  }
  return process.env.NODE_ENV !== 'production' ? 'dev-operator' : 'operator-ui';
}

export async function getOperatorSession(): Promise<OperatorSession | null> {
  const cookieStore = await cookies();
  const operatorId = resolveOperatorId(cookieStore);

  const cookieRole = normalizeRole(cookieStore.get('arbibot_role')?.value);
  if (cookieRole !== null) {
    return { role: cookieRole, source: 'cookie', operatorId };
  }

  const envRole = normalizeRole(process.env.ARBIBOT_DEV_ROLE);
  if (envRole !== null) {
    return { role: envRole, source: 'env', operatorId };
  }

  if (process.env.NODE_ENV !== 'production') {
    return { role: 'operator', source: 'dev-default', operatorId };
  }

  return null;
}
