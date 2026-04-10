import type { ReactNode } from 'react';

import { DestructiveOperatorAction } from '../../components/domain/destructive-operator-action';

export default function PortfolioPage(): ReactNode {
  return (
    <main style={{ padding: '1.5rem 2rem' }}>
      <h1>Portfolio</h1>
      <p style={{ color: '#94a3b8' }}>
        Placeholder — integrate portfolio read API in Phase 2 (P2-2.1-PORT).
      </p>
      <section style={{ marginTop: '2rem' }}>
        <h2 style={{ fontSize: '1rem' }}>Dangerous actions</h2>
        <p style={{ color: '#94a3b8', fontSize: 14, maxWidth: 560 }}>
          Force hedge follows operator rules: impact preview, typed confirmation, then
          API + audit trail (wire backend when execution API is available).
        </p>
        <div style={{ marginTop: '0.75rem' }}>
          <DestructiveOperatorAction
            actionLabel="Force Hedge"
            title="Force hedge"
            impactLines={[
              'Submits a hedge plan for open exposure (exact legs depend on portfolio state).',
              'May reserve capital and create execution plans visible in /execution.',
              'Requires operator role and is recorded in the audit log.',
            ]}
            onConfirmed={async () => {
              // Wire: POST /execution/... with idempotency + audit-service entry.
              await Promise.resolve();
            }}
          />
        </div>
      </section>
    </main>
  );
}
