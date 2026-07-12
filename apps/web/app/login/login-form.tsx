'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import type { ReactNode } from 'react';
import { useState } from 'react';

import { formatRoleLabel, type OperatorRole } from '@/lib/operator-role';

const ROLES: OperatorRole[] = ['viewer', 'operator', 'admin'];

/**
 * Client form for `POST /api/auth/session`. Collects the operator bootstrap
 * token + requested role, submits to the session-issuance endpoint, and on
 * success redirects to the originally-requested page (or `/dashboard`).
 */
export function LoginForm(): ReactNode {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [bootstrapToken, setBootstrapToken] = useState('');
  const [role, setRole] = useState<OperatorRole>('operator');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(): Promise<void> {
    if (submitting) {
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/auth/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bootstrapToken, role }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? `HTTP ${res.status}`);
        return;
      }
      const from = searchParams.get('from');
      const safeFrom =
        typeof from === 'string' && from.startsWith('/') && !from.includes('..')
          ? from
          : '/dashboard';
      router.push(safeFrom);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error');
    } finally {
      setSubmitting(false);
    }
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    void submit();
  }

  return (
    <form onSubmit={handleSubmit} className="operator-login-form">
      <div className="operator-login-field">
        <label htmlFor="bootstrapToken" className="operator-login-label">
          Bootstrap token
        </label>
        <input
          id="bootstrapToken"
          name="bootstrapToken"
          type="password"
          autoComplete="off"
          required
          value={bootstrapToken}
          onChange={(e) => setBootstrapToken(e.target.value)}
          className="operator-login-input"
          disabled={submitting}
        />
      </div>

      <div className="operator-login-field">
        <label htmlFor="role" className="operator-login-label">
          Role
        </label>
        <select
          id="role"
          name="role"
          value={role}
          onChange={(e) => setRole(e.target.value as OperatorRole)}
          className="operator-login-input"
          disabled={submitting}
        >
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {formatRoleLabel(r)}
            </option>
          ))}
        </select>
      </div>

      {error !== null && (
        <p className="operator-login-error" role="alert">
          {error}
        </p>
      )}

      <button
        type="submit"
        className="operator-login-submit"
        disabled={submitting || bootstrapToken.length === 0}
      >
        {submitting ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  );
}
