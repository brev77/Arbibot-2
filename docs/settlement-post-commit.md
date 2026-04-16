# Post-commit settlement (execution → portfolio → capital)

After `apply-fill` commits in `execution-orchestrator`, [`FillOutboundService`](../apps/execution-orchestrator/src/legs/fill-outbound.service.ts) performs **best-effort HTTP** to:

1. `portfolio-service` `POST /positions/confirm-fill` (single-writer for positions).
2. `plans.tryMarkPlanCompletedWhenAllLegsFilled` (same DB transaction boundary as orchestrator DB).
3. `capital-service` `POST /capital/reservations/:id/release` when the plan reaches `completed`.

This is **outside** the leg fill transaction: if portfolio HTTP fails after the DB commit, the system can show a **completed leg** without a matching portfolio row until repaired.

## Mitigations (current)

- **Idempotency:** portfolio `confirm-fill` uses `(leg_id, idempotency_key)`; capital `release` is idempotent.
- **Retries:** `FillOutboundService` retries transient HTTP statuses (429, 502, 503, 504) a few times with backoff.
- **Reconciliation:** [`reconciliation-service`](../apps/reconciliation-service/src/mismatches/mismatches.service.ts) detector `completed_plan_missing_portfolio` flags gaps for operators.

## Definition of done (Phase 2.1 FILL slice)

Treat settlement as **closed for a release candidate** when all of the following have been demonstrated in a migrated dev/stage database:

1. **Happy path:** `EXECUTION_SETTLEMENT_ENABLED=true`, portfolio and capital URLs set, full leg fill → portfolio row exists for the plan’s [`instrumentKey`](../apps/execution-orchestrator/src/legs/legs.service.ts) (plan `routeKey`, else `arb:risk-decision:{id}`, else `arb:execution-plan:{id}`) → plan `completed` → capital reservation released.
2. **Gap visibility:** simulate a failed `confirm-fill` (stop portfolio, or use **`EXECUTION_SETTLEMENT_SIMULATE_PORTFOLIO_FAILURE_ON_LEG_INDEXES`** below) so the plan can still reach `completed` while portfolio is missing → run `POST /mismatches/run-detectors` → open mismatch `completed_plan_missing_portfolio` appears → operator moves it through `investigating` → `resolved` in UI or `PATCH /mismatches/:id`.

## Environment

See [`.env.example`](../.env.example) and [`FillOutboundService`](../apps/execution-orchestrator/src/legs/fill-outbound.service.ts).

- **`EXECUTION_SETTLEMENT_ENABLED`:** gate (`true` enables post-commit HTTP).
- **Portfolio base URL:** `process.env.PORTFOLIO_SERVICE_URL ?? process.env.PORTFOLIO_API_BASE`. Prefer **`PORTFOLIO_API_BASE`** (same name as `apps/web` BFF); **`PORTFOLIO_SERVICE_URL`** remains an optional override for orchestrator-only deploys.
- **Capital release base URL:** `CAPITAL_SERVICE_BASE_URL ?? CAPITAL_SERVICE_URL` (then code default `http://127.0.0.1:3011` if unset).
- **`EXECUTION_SETTLEMENT_SIMULATE_PORTFOLIO_FAILURE_ON_LEG_INDEXES`:** comma-separated leg indexes (e.g. `0` or `1` or `0,1`). Before any HTTP call to portfolio, `confirm-fill` throws for those indexes so you can reproduce settlement gaps against a running portfolio service (default: unset / no simulation).

## Future hardening (not implemented here)

- Outbox-driven async settlement worker with DLQ.
- Automatic compensating transition on repeated failure (requires domain approval).
