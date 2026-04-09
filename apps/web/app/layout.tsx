import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { OperatorNav } from '../components/operator-nav';
import { getOperatorSession } from '../lib/operator-session';

import { Providers } from './providers';

import './globals.css';

export const metadata: Metadata = {
  title: 'Arbibot 2 — Operator',
  description: 'Unified operator surface (Phase 1 scaffold)',
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>): Promise<ReactNode> {
  const session = await getOperatorSession();

  return (
    <html lang="en">
      <body>
        {session === null ? (
          <main style={{ padding: '2rem', maxWidth: 720 }}>
            <h1 style={{ marginTop: 0 }}>Operator access unavailable</h1>
            <p style={{ color: '#94a3b8' }}>
              Configure `ARBIBOT_DEV_ROLE` or set the `arbibot_role` cookie to
              `viewer`, `operator`, or `admin` before using the operator UI.
            </p>
          </main>
        ) : (
          <Providers>
            <OperatorNav session={session} />
            {children}
          </Providers>
        )}
      </body>
    </html>
  );
}
