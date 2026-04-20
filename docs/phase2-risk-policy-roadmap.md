# Phase 2.2 policy roadmap (`P2-2.2-PROF`, `P2-2.2-ADRISK`, `P2-2.2-PLAY`)

## Current checkpoint

- `risk-service` exposes **`GET /policy/phase2-readiness`** (schema v2), **`GET /policy/token-profiles`**, **`GET /policy/route-profiles`**, and **`POST /evaluate-risk`** accepts optional `instrumentKey` / `routeKey` with DB-backed caps (migration `015_token_route_profiles.sql`).
- **Watchlist / route scoring writers (2026-04-19):** scheduled + HTTP-triggered jobs append to `watchlist_tier_snapshots` and `route_scoring_history` (single-writer: risk-service). See [`docs/watchlist-tiering-logic.md`](watchlist-tiering-logic.md) and [`docs/route-scoring-logic.md`](route-scoring-logic.md). Triggers: `POST /policy/jobs/watchlist-tiering`, `POST /policy/jobs/route-scoring` with header `x-arbibot-job-trigger` (env `RISK_POLICY_JOB_TRIGGER_TOKEN`). Metrics: `arb_watchlist_tier_*`, `arb_route_scoring_*`, histogram `arb_route_scoring_score_distribution`.
- Prometheus **`arb_execution_leg_partial_fill_commits_total`** on `apply-fill` → `partiallyFilled` in `execution-orchestrator` (partial playbook signal).
- Hedge/unwind orchestration runs and deeper adaptive engines remain backlog on top of this slice.

## Intended sequencing

1. **`P2-2.2-PROF`** — Done baseline: PostgreSQL tables + read API + evaluate consumption (see plan `P2-2.2-PROF`).
2. **`P2-2.2-ADRISK`** — Done minimal slice: profile caps compose with existing `riskMode` thresholds; extend with dedicated config service / sizing tables as needed.
3. **`P2-2.2-PLAY`** — Done minimal slice: partial-fill metric; add hedge/unwind runbooks when operator APIs exist (`P2-2.1-EPL` + venue path already landed).

## Phase 4 bridge (prep)

Watchlist tiering + route scoring **writers** and read APIs are implemented under **risk-service** (see [`docs/watchlist-tiering-logic.md`](watchlist-tiering-logic.md), [`docs/route-scoring-logic.md`](route-scoring-logic.md)). For how this ties to **`P4-4-TIER` / `P4-4-SCORE` / intake throttling**, see [`docs/phase4-prep-bridge.md`](phase4-prep-bridge.md) and [`docs/intake-policy-config-keys.md`](intake-policy-config-keys.md).

## Invariants

- Reservation-first and audit on any operator-visible mutation.
- OpenAPI / `@arbibot/contracts` route mirrors updated whenever public paths change.
