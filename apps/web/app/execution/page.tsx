import type { ReactNode } from 'react';

export default function ExecutionPage(): ReactNode {
  return (
    <main style={{ padding: '1.5rem 2rem' }}>
      <h1>Execution</h1>
      <p style={{ color: '#94a3b8' }}>
        Placeholder — master/detail and action previews (§5.4) in Phase 2.
        Orchestrator API: POST /execution/plans, /link-reservation, /arm.
      </p>
    </main>
  );
}
