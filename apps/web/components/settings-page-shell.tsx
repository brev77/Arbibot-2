'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useState, type ReactNode } from 'react';

import { SettingsWorkspace } from '@/components/settings-workspace';
import { Button } from '@/components/ui/button';

export function SettingsPageShell(): ReactNode {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [envInput, setEnvInput] = useState(() => searchParams.get('environment') ?? '');
  const [tenantInput, setTenantInput] = useState(() => searchParams.get('tenantId') ?? '');

  const environment = searchParams.get('environment')?.trim() || undefined;
  const tenantId = searchParams.get('tenantId')?.trim() || undefined;

  const applyQuery = (): void => {
    const p = new URLSearchParams();
    const e = envInput.trim();
    const t = tenantInput.trim();
    if (e) p.set('environment', e);
    if (t) p.set('tenantId', t);
    const qs = p.toString();
    router.replace(qs.length > 0 ? `/settings?${qs}` : '/settings');
  };

  const clearQuery = (): void => {
    setEnvInput('');
    setTenantInput('');
    router.replace('/settings');
  };

  return (
    <>
      <section className="mb-6 rounded-lg border border-slate-700/60 bg-slate-950/40 px-4 py-4 html.theme-light:border-slate-200 html.theme-light:bg-white">
        <h2 className="mt-0 text-base font-medium text-slate-100 html.theme-light:text-slate-900">
          Effective policy context
        </h2>
        <p className="mb-3 text-sm text-slate-400 html.theme-light:text-slate-600">
          Optional <code className="text-xs">environment</code> and{' '}
          <code className="text-xs">tenantId</code> query parameters control scope fallback for{' '}
          <code className="text-xs">…/effective</code> (tenant → environment → global). They are stored in the URL
          so links are shareable.
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <label className="block min-w-[160px] flex-1 text-sm text-slate-300 html.theme-light:text-slate-700">
            Environment
            <input
              className="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm html.theme-light:border-slate-300 html.theme-light:bg-white"
              value={envInput}
              onChange={(e) => setEnvInput(e.target.value)}
              placeholder="e.g. staging"
            />
          </label>
          <label className="block min-w-[160px] flex-1 text-sm text-slate-300 html.theme-light:text-slate-700">
            Tenant id
            <input
              className="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm html.theme-light:border-slate-300 html.theme-light:bg-white"
              value={tenantInput}
              onChange={(e) => setTenantInput(e.target.value)}
              placeholder="optional"
            />
          </label>
          <Button type="button" variant="secondary" size="sm" onClick={applyQuery}>
            Apply to URL
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={clearQuery}>
            Clear
          </Button>
        </div>
        <p className="mb-0 mt-3 text-xs text-slate-500">
          Active for requests: environment=<strong>{environment ?? '—'}</strong>, tenantId=
          <strong>{tenantId ?? '—'}</strong>
        </p>
      </section>

      <SettingsWorkspace environment={environment} tenantId={tenantId} />
    </>
  );
}
