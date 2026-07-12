import type { ReactNode } from 'react';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { OperatorAccessMessage } from '../components/operator-access-message';
import { formatRoleLabel, minimumRoleForPathname } from '../lib/operator-role';
import { getOperatorSession } from '../lib/operator-session';

type HomeSearchParams = { forbidden?: string; from?: string };

function sanitizeFromPath(raw: string | undefined): string | null {
  if (typeof raw !== 'string' || raw.length === 0) {
    return null;
  }
  if (!raw.startsWith('/') || raw.includes('..')) {
    return null;
  }
  return raw;
}

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<HomeSearchParams>;
}): Promise<ReactNode> {
  const sp = await searchParams;

  if (sp.forbidden === '1') {
    const from = sanitizeFromPath(sp.from);
    const minimum = from !== null ? minimumRoleForPathname(from) : null;
    return (
      <OperatorAccessMessage title="Access denied">
        {minimum !== null ? (
          <p>
            Your current role does not meet the requirement for{' '}
            {from !== null ? (
              <>
                the section at <code>{from}</code>, which requires at least the{' '}
                <strong>{formatRoleLabel(minimum)}</strong> role.
              </>
            ) : (
              <>
                this section, which requires at least the{' '}
                <strong>{formatRoleLabel(minimum)}</strong> role.
              </>
            )}
          </p>
        ) : (
          <p>You do not have permission to open the requested operator page.</p>
        )}
        <p>Sign in with a sufficient role or ask an administrator to update your access.</p>
        <div className="operator-access-actions">
          <Link href="/" className="operator-access-link">
            Home
          </Link>
          <Link href="/dashboard" className="operator-access-link">
            Try the dashboard
          </Link>
        </div>
      </OperatorAccessMessage>
    );
  }

  const session = await getOperatorSession();
  if (session === null && process.env.NODE_ENV === 'production') {
    return (
      <OperatorAccessMessage title="Operator access unavailable">
        <p>
          You are not signed in. Sign in with the operator bootstrap token to
          access the operator UI.
        </p>
        <div className="operator-access-actions">
          <Link href="/login" className="operator-access-link">
            Sign in
          </Link>
        </div>
      </OperatorAccessMessage>
    );
  }

  redirect('/dashboard');
}
