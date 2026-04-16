import type { ReactNode } from 'react';

import { DestructiveOperatorAction } from '../../../components/domain/destructive-operator-action';
import { getOperatorSession } from '../../../lib/operator-session';
import { formatRoleLabel } from '../../../lib/operator-role';

export default async function SettingsPage(): Promise<ReactNode> {
  const session = await getOperatorSession();
  const roleLabel =
    session === null ? 'No session' : formatRoleLabel(session.role);

  return (
    <main style={{ padding: '1.5rem 2rem' }}>
      <h1>Settings</h1>
      <section
        style={{
          marginBottom: '1.5rem',
          padding: '1rem',
          borderRadius: 8,
          border: '1px solid rgba(148, 163, 184, 0.35)',
          maxWidth: 560,
        }}
      >
        <h2 style={{ fontSize: '1rem', marginTop: 0 }}>Session (read-only)</h2>
        <p style={{ color: '#e2e8f0', fontSize: 14, marginBottom: 8 }}>
          Role: <strong>{roleLabel}</strong>
        </p>
        <p style={{ color: '#94a3b8', fontSize: 13, margin: 0 }}>
          Full operator preferences and config-layer editing (CFG-*) will replace this
          section when those APIs exist. This block is a narrow MVP for operator context
          only.
        </p>
      </section>
      <p style={{ color: '#94a3b8' }}>
        Operator settings beyond session; config layer CFG-* later.
      </p>
      <section style={{ marginTop: '2rem' }}>
        <h2 style={{ fontSize: '1rem' }}>Trading controls</h2>
        <p style={{ color: '#94a3b8', fontSize: 14, maxWidth: 560 }}>
          Suspend blocks new risk/capital reservations (impact preview required before
          confirm).
        </p>
        <div style={{ marginTop: '0.75rem' }}>
          <DestructiveOperatorAction
            actionLabel="Suspend trading"
            title="Suspend trading"
            impactLines={[
              'New opportunities may still be detected but will not receive reservations.',
              'In-flight plans are not automatically canceled — review /execution.',
              'Recorded in audit log; resume requires a separate operator action.',
            ]}
            confirmPhrase="SUSPEND"
            onConfirmed={() => {
              throw new Error('Trading suspend API is not configured yet.');
            }}
          />
        </div>
      </section>
    </main>
  );
}
