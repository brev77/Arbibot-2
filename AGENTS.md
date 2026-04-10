# Arbibot 2

## Cursor / agent instructions

### Overview

Arbibot 2 is a **Turborepo monorepo** (`npm` workspaces: `apps/*`, `packages/*`):

- **Backend:** multiple NestJS HTTP services on **Fastify** + **TypeORM** (PostgreSQL), optional Redis, Prometheus metrics via `@arbibot/nest-platform`.
- **Operator UI:** Next.js App Router in **`apps/web`** (`@arbibot/web`).

There is **no** `core-backend/` or `operator-frontend/` directory; older docs or audits may refer to that layout.

### Infrastructure

PostgreSQL 16 and Redis 7 for local dev:

```bash
docker compose -f infra/docker-compose.dev.yml up -d
```

Optional Kafka-compatible bus (Redpanda): add `--profile bus`.

```bash
docker compose -f infra/docker-compose.dev.yml --profile bus up -d
```

Use [`.env.example`](.env.example) as the source of truth for local env vars (`DATABASE_URL`, `REDIS_URL`, `CORS_ORIGINS`, `KAFKA_BROKERS`, `ARBIBOT_DEV_ROLE`, service URLs for `apps/web`).

### Root workspace

From the repo root:

- `npm ci` — install all workspaces
- `npm run lint` — Turbo lint (Nest apps, packages, `apps/web`)
- `npm run build` — Turbo build
- `npm run test` — Turbo test
- `npm run db:migrate` — apply SQL migrations under `infra/postgres/migrations/`
- `npm run bus:publish` — build and publish `SnapshotUpdated` from outbox to Kafka/Redpanda
- `npm run bus:consume` — build and run smoke consumer with inbox claim

Copy [`.env.example`](.env.example) to `.env` and adjust URLs; apps commonly read `PORT`, `DATABASE_URL`, `REDIS_URL`, `CORS_ORIGINS`, `RISK_SERVICE_URL`, `KAFKA_BROKERS`.

### Backend services (`apps/*`)

| App | Default PORT (env `PORT`) |
|-----|---------------------------|
| risk-service | 3000 |
| opportunity-service | 3010 |
| capital-service | 3011 |
| execution-orchestrator | 3012 |
| audit-service | 3013 |
| canonical-market-service | 3014 |
| market-intake-service | 3015 |

Each service: `npm run start:dev -w @arbibot/<name>` or use root scripts (`dev:risk`, `dev:opportunity`, … in [`package.json`](package.json)).

Shared libraries live under [`packages/`](packages/), especially:

- `@arbibot/contracts`
- `@arbibot/persistence`
- `@arbibot/messaging`
- `@arbibot/nest-database`
- `@arbibot/nest-platform`
- `@arbibot/outbox-kafka-bridge`

### Frontend (`apps/web`)

- Dev: `npm run dev -w @arbibot/web` (Next.js defaults to port **3000**; use another port if a Nest app uses 3000, e.g. `PORT=3001 npm run dev -w @arbibot/web`).
- Lint / build: `npm run lint -w @arbibot/web`, `npm run build -w @arbibot/web`.
- Server-side fetch base URLs come from `.env.example` (`OPPORTUNITY_SERVICE_URL`, `EXECUTION_ORCHESTRATOR_URL`, `AUDIT_SERVICE_URL`, etc.).

Operator session in dev: see `apps/web` middleware / `getOperatorSession` — `ARBIBOT_DEV_ROLE` or `arbibot_role` cookie.

### Current Phase 1 notes

- `opportunity-service` uses an in-DB relay for `RiskDecisionIssued` only.
- `@arbibot/outbox-kafka-bridge` publishes only `SnapshotUpdated` to Kafka/Redpanda and must not compete with the in-DB relay on the same event type.
- SQL migrations are applied lexicographically by `tools/db-migrate.mjs`; recent migrations include canonical market, market intake idempotency, and outbox relay dead-letter fields.
- Canonical registry tables are not auto-seeded; after migrations, `venue_refs`, `canonical_instruments`, and `canonical_routes` must be populated manually before `resolve-*` endpoints return data.

### CI

[`.github/workflows/ci.yml`](.github/workflows/ci.yml) runs on Node **22**: `npm ci`, then Turbo `lint`, `build`, `test` for the whole monorepo.
