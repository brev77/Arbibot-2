# CI verification checklist (post-merge)

Use after merging OpenClaw / intake / bus changes to `main`.

## GitHub Actions

1. Open the latest workflow run on `main` for [`.github/workflows/ci.yml`](../.github/workflows/ci.yml).
2. Confirm **all** jobs are green (seven parallel jobs after `build`):

| Job | Purpose |
|-----|---------|
| `build` | `npm run lint`, `build`, `test` (Turbo) |
| `e2e-phase2` | Phase 2 controlled execution (HTTP chain + Postgres) |
| `e2e-phase2-watchlist-route-scoring` | Risk policy writers smoke |
| `e2e-phase3-paper-promotion` | Paper promotion relay |
| `e2e-phase3-paper-discovery` | Paper discovery worker |
| `e2e-phase4-tier-routing` | Intake tier routing + throttle |
| `bus-smoke` | Outbox-kafka-bridge build + optional Redpanda compose |

Re-run failed jobs; capture logs under the job’s “Phase …” step.

## Local parity with the `build` job

From repo root (same as GitHub Actions `build` job):

```bash
npm run lint
npm run build
npm run test
```

**2026-04-20:** full `lint` / `build` / `test` completed successfully in a clean checkout after fixing stray `src/**/*.d.ts` emit under `apps/config-service` (see `apps/config-service/.gitignore`).

## Local optional checks

```bash
npm run ci:e2e-phase4-tier-routing
npm run ci:bus-smoke
```

- **bus-smoke** requires Docker available to the same shell as `bash` (see [`tools/ci-bus-smoke.sh`](../tools/ci-bus-smoke.sh)).
- **Windows:** if `bash` runs in WSL without Docker socket, run the PowerShell steps documented in `ci-bus-smoke.sh` or enable WSL integration in Docker Desktop.

## Full bus path (staging / manual)

1. `npm run db:migrate`
2. `npm run seed:outbox-smoke-events` (one `SnapshotUpdated` row) **or** `npm run seed:outbox-smoke-events:all` (all Kafka bridge `event_type` values: SnapshotUpdated, CapitalReserved, PlanArmed, LegFilled, PlanCompleted)
3. `docker compose -f infra/docker-compose.dev.yml --profile bus up -d`
4. `npm run bus:publish` and `npm run bus:consume` with `DATABASE_URL` + `KAFKA_BROKERS` per [`docs/outbox-inbox.md`](outbox-inbox.md). Consumer logs `entityId` and, for `LegFilled` / `PlanCompleted`, `planId` / `legId` from payload when present.
