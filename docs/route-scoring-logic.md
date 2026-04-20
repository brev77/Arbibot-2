# Route scoring history writer (PRIO-P2-SCORE)

## Purpose

Append-only samples in `route_scoring_history` track a **score** in \([0,1]\) per `route_key` for model / policy quality visibility. Aligns with Phase 4 `P4-4-SCORE` (replay / analytics) as a minimal v1 slice.

## Single-writer

- **risk-service** is the only writer for `route_scoring_history`.

## Inputs (v1)

- **`route_profiles`** — each `route_key` with `max_notional_usd` (cap proxy).
- **`risk_decisions`** in a rolling lookback window where `route_key` matches (approved vs total).

## Score (v1)

For each route in `route_profiles`:

1. `approvedCount` / `totalCount` of `risk_decisions` with that `route_key` and `created_at` ≥ **now − lookback**.
2. If `totalCount === 0`, use **approvalRatio = 0.5** (neutral prior).
3. **Notional factor** `nf = clamp(0, 1, log10(1 + maxNotionalUsd) / log10(1 + capRef))` with `ROUTE_SCORING_NOTIONAL_REF_USD` (default **5_000_000**).
4. **score** = `clamp(0, 1, 0.7 * approvalRatio + 0.3 * nf)`.

## Model version string

`risk_v1_<lookback>h` — e.g. `risk_v1_24h` when `ROUTE_SCORING_LOOKBACK_HOURS=24`.

## Append policy

- If the latest row for `route_key` has the **same** `score` (to 6 decimal places) **and** `model_version`, skip insert.
- Else append.

## Scheduling

- Interval: `ROUTE_SCORING_INTERVAL_MS` (default **3600000** = 1 hour).
- Disabled when `RISK_POLICY_JOBS_ENABLED=false`.
- Manual / CI: `POST /policy/jobs/route-scoring`.

## Trigger authentication

Both job endpoints require:

- Header: `x-arbibot-job-trigger: <token>`
- Env: `RISK_POLICY_JOB_TRIGGER_TOKEN` must match (non-empty). If unset, endpoints return **503** with a safe message (no token echo).

## Metrics

- `arb_route_scoring_evaluations_total`
- `arb_route_scoring_changes_total`
- Histogram `arb_route_scoring_score_distribution` (observed score on each **persisted** sample).

## Read API

- `GET /policy/route-scoring-history/:routeKey` — unchanged; returns recent rows for that route.

## Replay (P4-4-SCORE)

Offline export, staging job re-run, and compare/summary tooling are documented in [`docs/route-scoring-replay.md`](route-scoring-replay.md).
