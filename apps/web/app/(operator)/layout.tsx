import type { ReactNode } from 'react';
import Link from 'next/link';

import { DegradedStatusBanner } from '../../components/degraded-status-banner';
import { DexHealthBanner } from '../../components/dex-health-banner';
import { SafeModeBanner } from '../../components/safe-mode-banner';
import { OperatorAccessMessage } from '../../components/operator-access-message';
import { OperatorFiltersBar } from '../../components/operator-filters-bar';
import { OperatorNav } from '../../components/operator-nav';
import { getOperatorSession } from '../../lib/operator-session';

import { Providers } from '../providers';

export default async function OperatorLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>): Promise<ReactNode> {
  const session = await getOperatorSession();

  if (session === null) {
    return (
      <Providers>
        <OperatorAccessMessage title="Operator access unavailable">
          <p>
            Configure <code>ARBIBOT_DEV_ROLE</code> or set the{' '}
            <code>arbibot_role</code> cookie to <code>viewer</code>,{' '}
            <code>operator</code>, or <code>admin</code> before using the operator
            UI.
          </p>
          <p className="mb-0 text-sm text-slate-400 html.theme-light:text-slate-600">
            If you were redirected from a protected route, check your role and try again
            from home or the dashboard.
          </p>
          <div className="operator-access-actions">
            <Link href="/" className="operator-access-link">
              Home
            </Link>
            <Link href="/dashboard" className="operator-access-link">
              Try the dashboard
            </Link>
          </div>
        </OperatorAccessMessage>
      </Providers>
    );
  }

  return (
    <Providers>
      <OperatorNav session={session} />
      <OperatorFiltersBar />
      <DegradedStatusBanner />
      <DexHealthBanner />
      <SafeModeBanner />
      {children}
    </Providers>
  );
}
