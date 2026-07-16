import type { ReactNode } from 'react';
import Link from 'next/link';

import { DegradedStatusBanner } from '../../components/degraded-status-banner';
import { DexHealthBanner } from '../../components/dex-health-banner';
import { SafeModeBanner } from '../../components/safe-mode-banner';
import { OperatorAccessMessage } from '../../components/operator-access-message';
import { OperatorFiltersBar } from '../../components/operator-filters-bar';
import { OperatorNav } from '../../components/operator-nav';
import { PanicButton } from '../../components/panic-button';
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
            You are not signed in. Sign in with the operator bootstrap token to
            access the operator UI.
          </p>
          <p className="mb-0 text-sm text-slate-400 html.theme-light:text-slate-600">
            If you were redirected from a protected route, sign in and you will be
            returned to it automatically.
          </p>
          <div className="operator-access-actions">
            <Link href="/login" className="operator-access-link">
              Sign in
            </Link>
            <Link href="/" className="operator-access-link">
              Home
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
      {/* Emergency-stop button: only operators/admins (viewers cannot mutate). */}
      {(session.role === 'operator' || session.role === 'admin') && (
        <div className="fixed bottom-4 right-4 z-40">
          <PanicButton />
        </div>
      )}
      <DegradedStatusBanner />
      <DexHealthBanner />
      <SafeModeBanner />
      {children}
    </Providers>
  );
}
