import type { ReactNode } from 'react';

export function toOperatorBffError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

/** Shared troubleshooting copy for BFF → paper-trading-service reads. */
export function PaperFeedErrorHint(): ReactNode {
  return (
    <p className="mt-2 mb-0 text-xs text-slate-500 html.theme-light:text-slate-600">
      Run <code className="text-xs">npm run dev:paper</code> (port 3018), apply migrations{' '}
      <code className="text-xs">016</code>–<code className="text-xs">018</code> via{' '}
      <code className="text-xs">npm run db:migrate</code>, set <code className="text-xs">PAPER_API_BASE</code> for
      the web BFF. For enqueue → relay → paper, set <code className="text-xs">PAPER_TRADING_SERVICE_URL</code> on{' '}
      opportunity-service.
    </p>
  );
}

export function PaperBffSectionFault({
  label,
  error,
}: {
  readonly label: string;
  readonly error: Error;
}): ReactNode {
  return (
    <div className="rounded-lg border border-red-900/40 bg-slate-950/40 p-4 html.theme-light:border-red-200 html.theme-light:bg-red-50/30">
      <p className="m-0 text-sm font-medium text-red-200 html.theme-light:text-red-900">{label}</p>
      <p className="mt-1 mb-0 text-xs text-slate-400 html.theme-light:text-slate-700">{error.message}</p>
      <PaperFeedErrorHint />
    </div>
  );
}
