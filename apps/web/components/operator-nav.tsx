import Link from 'next/link';
import type { ReactNode } from 'react';

import type { OperatorSession } from '../lib/operator-session';
import { ThemeToggle } from './theme-toggle';

const links = [
  { href: '/dashboard', label: 'Dashboard', minRole: 'viewer' },
  { href: '/portfolio', label: 'Portfolio', minRole: 'viewer' },
  { href: '/opportunities', label: 'Opportunities', minRole: 'viewer' },
  { href: '/execution', label: 'Execution', minRole: 'operator' },
  { href: '/tokens', label: 'Tokens', minRole: 'operator' },
  { href: '/paper', label: 'Paper', minRole: 'operator' },
  { href: '/incidents', label: 'Incidents', minRole: 'operator' },
  { href: '/runbooks', label: 'Runbooks', minRole: 'operator' },
  { href: '/openclaw', label: 'OpenClaw', minRole: 'admin' },
  { href: '/settings', label: 'Settings', minRole: 'admin' },
] as const;

const roleRank = {
  viewer: 1,
  operator: 2,
  admin: 3,
} as const;

export function OperatorNav({
  session,
}: {
  session: OperatorSession;
}): ReactNode {
  const visibleLinks = links.filter(
    (link) => roleRank[session.role] >= roleRank[link.minRole],
  );

  return (
    <header
      className="operator-top-nav"
      style={{
        borderBottom: '1px solid #1e293b',
        padding: '0.75rem 1.5rem',
        display: 'flex',
        alignItems: 'center',
        gap: '1rem',
        flexWrap: 'wrap',
        background: '#0f172a',
      }}
    >
      <Link href="/dashboard" className="operator-brand">
        Arbibot 2
      </Link>
      <nav style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
        {visibleLinks.map((l) => (
          <Link key={l.href} href={l.href} className="operator-nav-link">
            {l.label}
          </Link>
        ))}
      </nav>
      <div
        style={{
          marginLeft: 'auto',
          display: 'flex',
          alignItems: 'center',
          gap: '0.75rem',
        }}
      >
        <ThemeToggle />
        <div
          style={{
            color: '#94a3b8',
            fontSize: 12,
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
          }}
        >
          {session.role}
        </div>
      </div>
    </header>
  );
}
