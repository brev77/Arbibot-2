# E2E scenarios (reference)

Commands are defined in the root [`package.json`](../package.json). This document summarizes intent; ports/env match [`.env.example`](../.env.example).

## Phase 1 — foundation chain

**Script:** `npm run e2e:phase1-foundation`  
**Implementation:** [`tools/e2e-phase1-foundation-chain.mjs`](../tools/e2e-phase1-foundation-chain.mjs)

**Flow:** market snapshot → opportunity → risk evaluate → capital reserve → execution arm (optional leg apply with `E2E_INCLUDE_EXECUTION_LEG=true`).

**Requires:** migrated DB; services: `market-intake`, `opportunity`, `risk`, `capital`, `execution-orchestrator` (see script header for URLs).

## Phase 2 — controlled execution (full plan completion)

**Script:** `npm run e2e:phase2-controlled-execution`  
**Implementation:** [`tools/e2e-phase2-controlled-execution.mjs`](../tools/e2e-phase2-controlled-execution.mjs)

**Flow:** extends Phase 1 through all execution legs until plan `completed`; supports multi-leg via `EXECUTION_BEGIN_LEG_COUNT` on the orchestrator.

**CI:** `npm run ci:e2e-phase2` / job `e2e-phase2` — Postgres + lab HTTP venue + built Nest apps.

## Phase 2 — policy writers (watchlist / route scoring)

**Script:** `npm run e2e:phase2-watchlist-route-scoring`  
**CI:** `npm run ci:e2e-phase2-watchlist-route-scoring`

Seeds profiles via `DATABASE_URL`, triggers `POST /policy/jobs/*` on **risk-service** with `RISK_POLICY_JOB_TRIGGER_TOKEN`.

## Phase 4 — intake tier routing

**Script:** `npm run e2e:phase4-tier-routing`  
**CI:** `npm run ci:e2e-phase4-tier-routing`

Requires **risk-service**, **config-service**, **market-intake** with `INTAKE_THROTTLING_ENABLED=true` and seeded `intake.*` policy (migration `029` or `npm run seed:intake-policy-config`).
