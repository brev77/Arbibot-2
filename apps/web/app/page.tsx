import type { ReactNode } from 'react';

export default function HomePage(): ReactNode {
  return (
    <main style={{ padding: '2rem', fontFamily: 'system-ui' }}>
      <h1>Arbibot 2</h1>
      <p>Operator UI scaffold — see .cursor/plans/DEVELOPMENT_PLAN.md for routes.</p>
    </main>
  );
}
