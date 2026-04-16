import type { ReactNode } from 'react';

import { DestructiveOperatorAction } from '../../../components/domain/destructive-operator-action';

export default function SettingsPage(): ReactNode {
  return (
    <main style={{ padding: '1.5rem 2rem' }}>
      <h1>Settings</h1>
      <p style={{ color: '#94a3b8' }}>
        Placeholder — operator settings; config layer CFG-* later.
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
            onConfirmed={async () => {
              // Wire: config/control-plane API + audit entry (admin-only).
              await Promise.resolve();
            }}
          />
        </div>
      </section>
    </main>
  );
}
