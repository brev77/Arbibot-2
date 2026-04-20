# Watchlist auto-tiering (PRIO-P2-TIER)

## Purpose

Append-only rows in `watchlist_tier_snapshots` classify **instrument keys** into **hot**, **warm**, or **cold** tiers for operator visibility and future intake/throttling policy (see architecture §27 / `P4-4-TIER` roadmap).

## Single-writer

- **risk-service** is the only writer for `watchlist_tier_snapshots`.
- Other services must not insert/update/delete this table.

## Inputs (v1)

- **`token_profiles.max_notional_usd`** — proxy for “size / liquidity appetite” configured for the instrument (Phase 2.2 profiles).
- **Optional:** later versions may join canonical registry, snapshot volume, or execution stats.

## Tier rules (v1)

Configurable USD thresholds (env, defaults in parentheses):

| Env | Default | Meaning |
|-----|---------|--------|
| `WATCHLIST_TIER_HOT_MIN_USD` | `1000000` | `max_notional_usd` ≥ this → **hot** |
| `WATCHLIST_TIER_WARM_MIN_USD` | `100000` | `max_notional_usd` ≥ this (and &lt; hot) → **warm** |
| — | — | otherwise → **cold** |

Invalid / missing env values fall back to defaults.

## Snapshot policy

- On each writer run, for every token profile row (up to the same cap as `GET /policy/token-profiles`, currently 500):
  - Compute `tier` + human-readable `reason` (includes cap and thresholds).
  - **If** the latest snapshot for that `instrument_key` has the **same** `tier` **and** `reason`, **skip** insert (reduces noise; still counts as an evaluation in metrics).
  - Otherwise `INSERT` a new snapshot (append-only).

## Scheduling

- Background interval: `WATCHLIST_TIERING_INTERVAL_MS` (default **600000** = 10 minutes).
- Disabled when `RISK_POLICY_JOBS_ENABLED=false`.
- Manual / CI trigger: `POST /policy/jobs/watchlist-tiering` (see [`docs/route-scoring-logic.md`](route-scoring-logic.md) for shared trigger auth).

## Metrics

- `arb_watchlist_tier_evaluations_total` — writer runs × instruments evaluated.
- `arb_watchlist_tier_changes_total` — new snapshots persisted (tier or reason changed).

## Read API

- `GET /policy/watchlist/tiers` — latest snapshot per instrument (PostgreSQL `DISTINCT ON`), capped at 500 rows.
