# Partial fill playbooks (P2-2.2-PLAY)

Execution plans may carry optional **`playbook_config`** (`execution_plans.playbook_config`, JSONB) to describe operator-approved behaviour when legs receive **partial** venue fills.

## Schema (v1)

| Field | Type | Description |
|-------|------|-------------|
| `partialFillStrategy` | `continue` \| `hedge` \| `unwind` | High-level strategy after a partial commit. |
| `driftBpsThreshold` | number | Optional: if paper/live drift exceeds this (bps), prefer `unwind` or escalate (future). |
| `maxPartialLegCommits` | integer ≥ 1 | Safety cap on partial apply-fill commits per leg before forced review. |

## Validation

`PartialFillPlaybookService` in **`apps/execution-orchestrator`** validates JSON before persisting on plan mutation paths (extend orchestration when playbooks are wired to `POST`/`PATCH` plan APIs).

## Observability

Partial commits increment **`arb_execution_leg_partial_fill_commits_total`** (see `apps/execution-orchestrator/src/legs/execution-leg-metrics.ts`).

## References

- Phase 2 roadmap: `docs/phase2-risk-policy-roadmap.md`
- Execution leg states: `docs/state-machines.md`
