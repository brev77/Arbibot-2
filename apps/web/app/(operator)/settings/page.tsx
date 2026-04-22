import type { ReactNode } from 'react';
import { Suspense } from 'react';

import { SettingsPageShell } from '../../../components/settings-page-shell';
import { getOperatorSession } from '../../../lib/operator-session';
import { formatRoleLabel } from '../../../lib/operator-role';

export default async function SettingsPage(): Promise<ReactNode> {
  const session = await getOperatorSession();
  const roleLabel =
    session === null ? 'No session' : formatRoleLabel(session.role);

  return (
    <main className="px-6 py-6 mx-auto max-w-[1100px] text-slate-200 html.theme-light:text-slate-900">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="mt-0 text-2xl font-semibold">Settings</h1>
          <p className="mb-0 text-sm text-slate-400 html.theme-light:text-slate-600">
            Policy configurations via <code className="text-xs">config-service</code> (admin only).
          </p>
        </div>
      </div>

      <section className="mb-6 rounded-lg border border-slate-700/60 bg-slate-950/40 px-4 py-4 html.theme-light:border-slate-200 html.theme-light:bg-white">
        <h2 className="mt-0 text-base font-medium text-slate-100 html.theme-light:text-slate-900">
          Session (read-only)
        </h2>
        <p className="mb-0 text-sm text-slate-400 html.theme-light:text-slate-600">
          Role: <strong className="text-slate-200 html.theme-light:text-slate-900">{roleLabel}</strong>
        </p>
      </section>

      <Suspense
        fallback={<p className="text-sm text-slate-500">Loading settings…</p>}
      >
        <SettingsPageShell />
      </Suspense>
    </main>
  );
}
