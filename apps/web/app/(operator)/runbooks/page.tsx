import Link from 'next/link';
import type { ReactNode } from 'react';

type RunbookStub = {
  readonly id: string;
  readonly title: string;
  readonly summary: string;
  readonly steps: readonly string[];
};

/** Static catalog until runbook API + approvals ship (P2-2.3-INCRB read shell). */
const RUNBOOK_CATALOG: readonly RunbookStub[] = [
  {
    id: 'rb-settlement-gap',
    title: 'Post-commit settlement gap (portfolio / capital)',
    summary:
      'Leg fill committed in orchestrator but portfolio or capital HTTP failed after the DB transaction.',
    steps: [
      'Read `docs/settlement-post-commit.md` for retries and idempotency keys.',
      'Run reconciliation detectors; open `/incidents` for `completed_plan_missing_portfolio` or `executing_plan_legs_filled_not_completed`.',
      'Correlate `GET /execution/plans/:id`, `GET /positions`, and audit entries before any manual repair.',
    ],
  },
  {
    id: 'rb-partial-fill',
    title: 'Partial fill — assess exposure',
    summary:
      'Inspect execution plan state, legs, and reservations before any hedge or unwind.',
    steps: [
      'Open the plan in Execution and review the timeline (audit-linked).',
      'Confirm capital reservation and risk decision ids still match intent.',
      'Use controlled execution APIs (when available) only after impact preview + approval.',
    ],
  },
  {
    id: 'rb-reservation-stale',
    title: 'Stale or expired capital reservation',
    summary:
      'Validate TTL and orchestrator state before re-arming or releasing capital.',
    steps: [
      'Check reservation materialization via capital-service read API.',
      'Correlate audit entries for ReserveCapital / LinkReservation / ArmPlan.',
      'Escalate if outbox or bus shows publish failures (see observability docs).',
    ],
  },
];

export default function RunbooksPage(): ReactNode {
  return (
    <main style={{ padding: '1.5rem 2rem', maxWidth: 960 }}>
      <h1 style={{ marginTop: 0 }}>Runbooks</h1>
      <p style={{ color: '#94a3b8', marginBottom: '1.5rem' }}>
        Read-oriented catalog (§5.7). “Start runbook” flows with approvals are out of
        scope until operator mutation APIs exist — no fake writes here.
      </p>

      <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {RUNBOOK_CATALOG.map((rb) => (
          <li
            key={rb.id}
            style={{
              marginBottom: '1.25rem',
              padding: '1rem 1.25rem',
              borderRadius: 8,
              border: '1px solid #1e293b',
              background: '#0f172a',
            }}
          >
            <h2 style={{ fontSize: '1.05rem', marginTop: 0 }}>{rb.title}</h2>
            <p style={{ color: '#94a3b8', fontSize: 14 }}>{rb.summary}</p>
            <ol style={{ color: '#cbd5e1', fontSize: 13, paddingLeft: '1.25rem' }}>
              {rb.steps.map((s) => (
                <li key={s} style={{ marginBottom: 6 }}>
                  {s}
                </li>
              ))}
            </ol>
            <p style={{ marginBottom: 0, marginTop: '0.75rem' }}>
              <button type="button" disabled>
                Start runbook (requires backend)
              </button>
            </p>
          </li>
        ))}
      </ul>

      <section style={{ marginTop: '2rem' }}>
        <h2 style={{ fontSize: '1.05rem' }}>Audit</h2>
        <p style={{ color: '#94a3b8', fontSize: 14 }}>
          Operator evidence should land in audit with explicit actions; cross-link
          from incidents when those entities exist.
        </p>
        <Link href="/dashboard" style={{ color: '#38bdf8', fontSize: 14 }}>
          Dashboard audit preview →
        </Link>
      </section>
    </main>
  );
}
