# Reconciliation P0: mismatch kinds and operator procedure

This document closes the **procedure** gap for matrix step **`PRIO-P0-RECON`**: canonical implementation lives in `P2-2.1-RECON` (`apps/reconciliation-service`, `/incidents` BFF in `apps/web`). Here we define **who does what** when an open mismatch exists.

## P0 mismatch kinds (current detectors)

| Kind | Meaning | Typical cause |
|------|---------|---------------|
| `completed_plan_missing_portfolio` | `execution_plans.state = completed` but no `portfolio_positions` row for that `plan_id`. | Settlement disabled, portfolio HTTP failure after fill, or manual DB drift. |
| `executing_plan_legs_filled_not_completed` | All legs are `filled` but plan is still `executing`. | Orchestrator completion gap / crash before plan terminal transition. |

Detectors are idempotent for **open** rows per `(kind, planId)` (see `MismatchesService.runDetectors`).

## Operator workflow

1. **Triage on `/incidents`:** filter `open`, read `kind` and `details.planId`, open linked execution plan if shown.
2. **Investigate:** use `Investigate` (or equivalent) to set status to `investigating`; add notes in your incident tool if outside the UI.
3. **Run detectors on demand:** `POST /mismatches/run-detectors` (also exposed via operator BFF) after fixing upstream data or releases, to refresh open rows without duplicating `(kind, planId)` opens.
4. **Resolve when safe:** after portfolio backfill, plan state repair, or acknowledged business exception, set `resolved` via `PATCH` / UI `Mark resolved`.
5. **Audit:** destructive or state-changing operator actions elsewhere must remain two-step per product rules; reconciliation status changes are audited when wired through normal operator APIs.

## SLA (v0)

- **P0 open mismatches:** acknowledge within **4 business hours**, target closure within **24 hours** once root cause class is known.
- **Escalation:** if `completed_plan_missing_portfolio` affects funded plans, treat as **capital exposure** until portfolio confirms or finance signs off.

## Review checklist (before marking `PRIO-P0-RECON` done)

- [ ] Both detector kinds documented above and tested in CI or manual runbook.
- [ ] `/incidents` can list, filter, transition `investigating` → `resolved`, and call `run-detectors`.
- [ ] Alert target `ReconciliationOpenMismatches` documented in `docs/observability-tracing.md`.
