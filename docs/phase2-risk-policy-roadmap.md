# Phase 2.2 policy roadmap (`P2-2.2-PROF`, `P2-2.2-ADRISK`, `P2-2.2-PLAY`)

## Current checkpoint

- `risk-service` exposes **`GET /policy/phase2-readiness`** (schema v2), **`GET /policy/token-profiles`**, **`GET /policy/route-profiles`**, and **`POST /evaluate-risk`** accepts optional `instrumentKey` / `routeKey` with DB-backed caps (migration `015_token_route_profiles.sql`).
- Prometheus **`arb_execution_leg_partial_fill_commits_total`** on `apply-fill` → `partiallyFilled` in `execution-orchestrator` (partial playbook signal).
- Hedge/unwind orchestration runs and deeper adaptive engines remain backlog on top of this slice.

## Intended sequencing

1. **`P2-2.2-PROF`** — Done baseline: PostgreSQL tables + read API + evaluate consumption (see plan `P2-2.2-PROF`).
2. **`P2-2.2-ADRISK`** — Done minimal slice: profile caps compose with existing `riskMode` thresholds; extend with dedicated config service / sizing tables as needed.
3. **`P2-2.2-PLAY`** — Done minimal slice: partial-fill metric; add hedge/unwind runbooks when operator APIs exist (`P2-2.1-EPL` + venue path already landed).

## Invariants

- Reservation-first and audit on any operator-visible mutation.
- OpenAPI / `@arbibot/contracts` route mirrors updated whenever public paths change.
