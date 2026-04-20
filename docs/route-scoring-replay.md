# Route scoring replay (P4-4-SCORE)

This runbook defines **offline** and **staging** replay for `route_scoring_history` ([`027_route_scoring_history.sql`](../infra/postgres/migrations/027_route_scoring_history.sql)) without introducing a second writer. The only producer of rows remains **risk-service** ([`RouteScoringWriterService`](../apps/risk-service/src/policy/route-scoring-writer.service.ts)).

## Invariants

- **Single-writer:** `risk-service` append-only; market-intake and analytics jobs must not insert into `route_scoring_history`.
- **Inputs:** scoring reads `route_profiles` and `risk_decisions` in a lookback window ([`docs/route-scoring-logic.md`](route-scoring-logic.md)). Reproducibility requires the same DB snapshot (or clone) and the same env (`ROUTE_SCORING_LOOKBACK_HOURS`, `ROUTE_SCORING_NOTIONAL_REF_USD`, wall-clock “now” at job time).

## Offline replay

1. **Export** a window as JSONL (or CSV):

   ```bash
   DATABASE_URL=... npm run export:route-scoring-history
   # Optional: ROUTE_KEY=... LOOKBACK_HOURS=168
   ```

2. **Baseline:** save stdout to `before.jsonl` (or attach as CI artifact).

3. **After a change** (new model version, different lookback, or refreshed staging DB): export again to `after.jsonl`.

4. **Compare** latest sample per `routeKey` between files:

   ```bash
   npm run replay:route-scoring-export -- compare before.jsonl after.jsonl
   ```

5. **Summarize** one file (counts, min/max/mean score per route):

   ```bash
   npm run replay:route-scoring-export -- summary before.jsonl
   ```

   With no path, the tool reads **stdin** (pipe from `export:route-scoring-history`).

6. **Manual diff:** for small files, `diff before.jsonl after.jsonl` after sorting is acceptable; JSONL order is not guaranteed to match across runs.

## Staging re-run

1. Apply migrations through [`npm run db:migrate`](../package.json) on the staging database (or restore a snapshot).

2. Align **risk-service** env with the scenario under test:
   - `DATABASE_URL`, `ROUTE_SCORING_LOOKBACK_HOURS`, `ROUTE_SCORING_NOTIONAL_REF_USD`, `ROUTE_SCORING_INTERVAL_MS` (if using the scheduler).
   - `RISK_POLICY_JOB_TRIGGER_TOKEN` (non-empty) for HTTP triggers.

3. Start **risk-service** and call the job:

   ```http
   POST /policy/jobs/route-scoring
   x-arbibot-job-trigger: <RISK_POLICY_JOB_TRIGGER_TOKEN>
   ```

4. **Verify** new rows:
   - SQL: see [`docs/phase4-prep-bridge.md`](phase4-prep-bridge.md) (latest per `route_key`), or
   - Export + `summary` / `compare` against a pre-job export.

5. **Operator read path (optional):** `GET /policy/route-scoring-history/:routeKey` or BFF `/api/operator/settings/route-scoring/[routeKey]` should list the new history tail.

## Large-scale analytics

When exports or ad-hoc SQL stress OLTP or exceed operational time budgets, follow the ClickHouse gate in [`docs/adr-phase4-clickhouse-gate.md`](adr-phase4-clickhouse-gate.md) instead of widening queries on the primary risk database.

## Related

- [`docs/route-scoring-logic.md`](route-scoring-logic.md) — scoring formula and writer behavior.
- [`tools/export-route-scoring-history.mjs`](../tools/export-route-scoring-history.mjs) — export implementation.
- [`tools/replay-route-scoring-export.mjs`](../tools/replay-route-scoring-export.mjs) — summary / compare helper.
