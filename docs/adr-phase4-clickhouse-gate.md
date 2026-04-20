# ADR: ClickHouse / analytics warehouse gate (P4-4-CH)

## Status

Accepted (2026-04-20). **ClickHouse is not deployed from this repository at this time.** This ADR defines **when** to introduce a columnar store or managed DWH for route-scoring and related policy analytics, and how to do so without violating single-writer boundaries.

## Context

- Route scoring history lives in PostgreSQL (`route_scoring_history`), written only by **risk-service** ([`docs/route-scoring-logic.md`](route-scoring-logic.md)).
- Offline export and replay are documented in [`docs/route-scoring-replay.md`](route-scoring-replay.md).
- Heavy ad-hoc SQL or unbounded exports against the **same** OLTP database as risk-service compete with `POST /evaluate-risk` and policy jobs.

## Decision

1. **No second writer:** Nothing except **risk-service** may insert/update/delete rows in `route_scoring_history` on the OLTP database. Analytics replicas, ClickHouse, or DWH are **read-only consumers** fed by batch ETL, logical replication, or explicit export — not by parallel scoring pipelines writing the same table.

2. **Gate triggers (any one is a signal to plan CH/DWH work):**
   - **Volume:** sustained growth where `route_scoring_history` row count or hourly append rate makes backups or vacuum/maintenance risky for the risk OLTP SLO.
   - **Query cost:** p95/p99 for `GET /policy/route-scoring-history/:routeKey` or operator exports (`export:route-scoring-history`) exceeds product budgets, or operators require scans that do not fit indexed access patterns.
   - **Index / disk:** `idx_route_scoring_history_route` bloat or table size drives storage alerts tied to the risk database.
   - **Product requirement:** dashboards or batch replay needing full-history scans across all routes on a schedule (beyond JSONL export windows).

3. **Anti-pattern:** Running wide aggregations, “last N months all routes”, or BI tools directly on the primary risk Postgres **after** the gate triggers — instead of offloading to CH/DWH.

4. **Latency and SLO:** Tiered sync API SLOs for the trading path remain in [`docs/observability-tracing.md`](observability-tracing.md) (Tier 1–3). **Analytics path** targets (export duration, batch ETL freshness) are documented in the same file under **Analytics path latency** — they are operational targets, not substitutes for Tier 1 latency.

5. **Local / dev compose:** An optional `analytics` profile in `docker-compose.dev.yml` was **not** added in this iteration. Teams may use vendor-managed ClickHouse or a one-off container when implementing the ETL project after the gate opens; keep that outside the critical path until needed.

## Consequences

- **Positive:** Clear criteria for when to invest in CH; preserves single-writer and OLTP health.
- **Negative:** Until the gate triggers, very large historical analyses rely on export + external tools or bounded SQL (see [`docs/phase4-prep-bridge.md`](phase4-prep-bridge.md)).

## Related

- [`docs/route-scoring-replay.md`](route-scoring-replay.md)
- [`docs/phase4-prep-bridge.md`](phase4-prep-bridge.md)
- [`P4-4-CH`](../.cursor/plans/DEVELOPMENT_PLAN.md) in `DEVELOPMENT_PLAN.md`
