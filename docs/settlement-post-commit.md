# Post-commit settlement (execution → portfolio → capital)

After `apply-fill` commits in `execution-orchestrator`, [`FillOutboundService`](../apps/execution-orchestrator/src/legs/fill-outbound.service.ts) performs **best-effort HTTP** to:

1. `portfolio-service` `POST /positions/confirm-fill` (single-writer for positions).
2. `plans.tryMarkPlanCompletedWhenAllLegsFilled` (same DB transaction boundary as orchestrator DB).
3. `capital-service` `POST /capital/reservations/:id/release` when the plan reaches `completed`.

This is **outside** the leg fill transaction: if portfolio HTTP fails after the DB commit, the system can show a **completed leg** without a matching portfolio row until repaired.

## Mitigations (current)

- **Idempotency:** portfolio `confirm-fill` uses `(leg_id, idempotency_key)`; capital `release` is idempotent.
- **Retries:** `FillOutboundService` retries transient HTTP statuses (429, 502, 503, 504) a few times with backoff.
- **Reconciliation:** [`reconciliation-service`](../apps/reconciliation-service/src/mismatches/mismatches.service.ts) detectors `completed_plan_missing_portfolio` and `executing_plan_legs_filled_not_completed` flag gaps for operators.

## Definition of done (Phase 2.1 FILL slice)

Treat settlement as **closed for a release candidate** when all of the following have been demonstrated in a migrated dev/stage database:

1. **Happy path:** `EXECUTION_SETTLEMENT_ENABLED=true`, portfolio and capital URLs set, full leg fill → portfolio row exists for the plan’s [`instrumentKey`](../apps/execution-orchestrator/src/legs/legs.service.ts) (plan `routeKey`, else `arb:risk-decision:{id}`, else `arb:execution-plan:{id}`) → plan `completed` → capital reservation released.
2. **Gap visibility (executing plan, filled legs):** with `EXECUTION_SETTLEMENT_ENABLED=true`, use **`EXECUTION_SETTLEMENT_SIMULATE_PORTFOLIO_FAILURE_ON_LEG_INDEXES`** (or stop portfolio) so `confirm-fill` throws **after** the leg is already `filled` in the DB. `FillOutboundService` runs **portfolio first**, then `tryMarkPlanCompletedWhenAllLegsFilled`; a failing `confirm-fill` **aborts** the chain, so the plan stays **`executing`** with all legs **`filled`** and no portfolio row. Run `POST /mismatches/run-detectors` → open mismatch **`executing_plan_legs_filled_not_completed`** → operator workflow as above.

3. **Gap visibility (completed plan, no portfolio):** mismatch **`completed_plan_missing_portfolio`** applies when the plan row is already **`completed`** but no `portfolio_positions` row exists (e.g. lab seed / manual drift). It is **not** produced by the portfolio simulation env alone, because a simulated `confirm-fill` failure prevents `tryMarkPlanCompleted` from running.

## Environment

See [`.env.example`](../.env.example) and [`FillOutboundService`](../apps/execution-orchestrator/src/legs/fill-outbound.service.ts).

- **`EXECUTION_SETTLEMENT_ENABLED`:** gate (`true` enables post-commit HTTP).
- **Portfolio base URL (required when settlement is on):** `process.env.PORTFOLIO_SERVICE_URL ?? process.env.PORTFOLIO_API_BASE` must be non-empty. If both are missing, `FillOutboundService` **throws** (`EXECUTION_SETTLEMENT_ENABLED=true requires PORTFOLIO_SERVICE_URL or PORTFOLIO_API_BASE; refusing silent skip of portfolio confirm-fill`) instead of skipping portfolio HTTP. Prefer **`PORTFOLIO_API_BASE`** (same name as `apps/web` BFF); **`PORTFOLIO_SERVICE_URL`** remains an optional override for orchestrator-only deploys.
- **Capital release base URL:** `CAPITAL_SERVICE_BASE_URL ?? CAPITAL_SERVICE_URL` (then code default `http://127.0.0.1:3011` if unset).
- **`EXECUTION_SETTLEMENT_SIMULATE_PORTFOLIO_FAILURE_ON_LEG_INDEXES`:** comma-separated leg indexes (e.g. `0` or `1` or `0,1`). Before any HTTP call to portfolio, `confirm-fill` throws for those indexes so you can reproduce settlement gaps against a running portfolio service (default: unset / no simulation).

## Future hardening (not implemented here)

- Outbox-driven async settlement worker with DLQ.
- Automatic compensating transition on repeated failure (requires domain approval).
