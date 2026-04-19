import type { ReactNode } from 'react';

import { SettingsWorkspace } from '../../../components/settings-workspace';
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
      </section>

      {/* Policy Configurations with SettingsWorkspace */}
      <SettingsWorkspace />
    </main>
  );
}
