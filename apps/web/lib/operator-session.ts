import { cookies } from 'next/headers';

import { SESSION_COOKIE, verifyOperatorSession } from './auth/session';
import { normalizeRole, type OperatorRole } from './operator-role';

export type { OperatorRole };

export interface OperatorSession {
  readonly role: OperatorRole;
  readonly source: 'jwt' | 'env' | 'dev-default';
  /** Stable operator identity for audit / config mutations (BFF forwards to backends). */
  readonly operatorId: string;
}

export async function getOperatorSession(): Promise<OperatorSession | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;

  // Signed JWT session — the only trusted session source in production.
  const claims = await verifyOperatorSession(token);
  if (claims !== null) {
    return { role: claims.role, source: 'jwt', operatorId: claims.sub };
  }

  // F4: ARBIBOT_DEV_ROLE is a no-op in production (defense-in-depth).
  // Even if the env var is accidentally set in a prod environment, we must not
  // grant a role from it. The signed JWT session is the only source in production.
  if (process.env.NODE_ENV !== 'production') {
    const envRole = normalizeRole(process.env.ARBIBOT_DEV_ROLE);
    if (envRole !== null) {
      const operatorId =
        process.env.ARBIBOT_DEV_OPERATOR_ID?.trim() || 'dev-operator';
      return { role: envRole, source: 'env', operatorId };
    }
    const operatorId =
      process.env.ARBIBOT_DEV_OPERATOR_ID?.trim() || 'dev-operator';
    return { role: 'operator', source: 'dev-default', operatorId };
  }

  return null;
}
