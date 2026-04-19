import Link from 'next/link';
import type { ReactNode } from 'react';

import type { OperatorSession } from '../lib/operator-session';
import { ThemeToggle } from './theme-toggle';

const links = [
  { href: '/dashboard', label: 'Dashboard', minRole: 'viewer' },
  { href: '/portfolio', label: 'Portfolio', minRole: 'operator' },
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
    <header className="flex items-center justify-between gap-4 flex-wrap p-3 px-6 border-b border-slate-800 bg-slate-900 html.theme-light:border-slate-200 html.theme-light:bg-slate-100">
      <Link href="/dashboard" className="operator-brand">
        Arbibot 2
      </Link>
      <nav className="flex gap-3 flex-wrap">
        {visibleLinks.map((l) => (
          <Link key={l.href} href={l.href} className="operator-nav-link">
            {l.label}
          </Link>
        ))}
      </nav>
      <div className="ml-auto flex items-center gap-3">
        <ThemeToggle />
        <div className="text-xs text-slate-400 uppercase tracking-widest html.theme-light:text-slate-600">
          {session.role}
        </div>
      </div>
    </header>
  );
}
