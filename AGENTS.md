# Arbibot 2

## Cursor / agent instructions

### graphify (knowledge graph)

The repo uses [graphify](https://github.com/safishamsi/graphify): `graphify-out/` is listed in `.gitignore` and is generated locally, not committed.

- Install once: `python -m pip install graphifyy`, then from the repo root `python -m graphify cursor install` (writes [`.cursor/rules/graphify.mdc`](.cursor/rules/graphify.mdc)).
- **Code-only refresh (AST, no LLM):** `python -c "from graphify.watch import _rebuild_code; from pathlib import Path; _rebuild_code(Path('.'))"` — updates `graphify-out/graph.json`, `GRAPH_REPORT.md`, and cache; use after code edits for a quick graph sync. On Windows if `python` is not on `PATH`, use the same one-liner with **`py -3`** instead of `python`.
- **Full graph (docs, markdown, images, semantic edges):** in Cursor run `/graphify .` (skill); after large doc changes use `/graphify . --update` per graphify docs.
- **Focused questions:** `python -m graphify query "<question>" --graph graphify-out/graph.json`
- For architecture questions, read `graphify-out/GRAPH_REPORT.md` first when that directory exists.

### Overview

Arbibot 2 is a **Turborepo monorepo** (`npm` workspaces: `apps/*`, `packages/*`):

- **Backend:** multiple NestJS HTTP services on **Fastify** + **TypeORM** (PostgreSQL), optional Redis, Prometheus metrics via `@arbibot/nest-platform`.
- **Operator UI:** Next.js App Router in **`apps/web`** (`@arbibot/web`).

There is **no** `core-backend/` or `operator-frontend/` directory; older docs or audits may refer to that layout.

**Operational backlog (what / when):** [`docs/TODO.md`](docs/TODO.md) — живой список рядом с каноном [.cursor/plans/DEVELOPMENT_PLAN.md](.cursor/plans/DEVELOPMENT_PLAN.md).

**OpenClaw:** сводка функций, запретов и Phase 5 — [`docs/openclaw-reference.md`](docs/openclaw-reference.md); границы API — [`docs/openclaw-operator-boundaries.md`](docs/openclaw-operator-boundaries.md).

**Первичный запуск (paper → live):** по замыслу владельцев продукта **paper trading** на стадии первого вывода в эксплуатацию — **обязательный** сквозной тест всего стека (данные → возможности → риск → капитал → виртуальное исполнение → observability/UI) и накопление статистики **без** реальных потерь; после приёмки включается **live с минимальным капиталом**. Это зафиксировано в `DEVELOPMENT_PLAN.md` (раздел «Операционная последовательность первичного запуска»), в архитектурном и фронтенд-спек-документах в корне репозитория.

### Infrastructure

PostgreSQL 16 and Redis 7 for local dev:

```bash
docker compose -f infra/docker-compose.dev.yml up -d
```

Optional Kafka-compatible bus (Redpanda): add `--profile bus`.

```bash
docker compose -f infra/docker-compose.dev.yml --profile bus up -d
```

Use [`.env.example`](.env.example) as the source of truth for local env vars (`DATABASE_URL`, `REDIS_URL`, `CORS_ORIGINS`, `KAFKA_BROKERS`, `ARBIBOT_DEV_ROLE`). For **`apps/web`** server-side BFF proxies, use **`*_API_BASE`** (see [`apps/web/lib/api-base.ts`](apps/web/lib/api-base.ts)), including **`PORTFOLIO_API_BASE`** and **`RECONCILIATION_API_BASE`**.

### Root workspace

From the repo root:

- `npm ci` — install all workspaces
- `npm run lint` — Turbo lint (Nest apps, packages, `apps/web`)
- `npm run build` — Turbo build
- `npm run test` — Turbo test
- `npm run db:migrate` — apply SQL migrations under `infra/postgres/migrations/`
- `npm run e2e:phase1-foundation` — HTTP smoke for Phase 1 DoD §50.3 (snapshot → opportunity → risk → reserve → arm); optional `E2E_INCLUDE_EXECUTION_LEG=true` extends through `apply-fill`; requires migrated DB and running `market-intake`, `opportunity`, `risk`, `capital`, `execution-orchestrator` (see `tools/e2e-phase1-foundation-chain.mjs` for ports / env overrides)
- `npm run e2e:phase2-controlled-execution` — extends the Phase 1 chain through **all** execution legs until the plan is `completed` (see `tools/e2e-phase2-controlled-execution.mjs`); use `EXECUTION_BEGIN_LEG_COUNT` on **execution-orchestrator** for multi-leg; optional settlement envs as in `docs/settlement-post-commit.md`
- `npm run ci:e2e-phase2` — same Phase 2 HTTP chain with **Postgres + lab HTTP venue + built Nest apps** (see `tools/ci-e2e-phase2.sh`); GitHub Actions runs this as job **`e2e-phase2`** after `npm run build`
- `npm run bus:publish` — build and publish outbox rows to Kafka/Redpanda for `SnapshotUpdated`, `CapitalReserved`, `PlanArmed`, `LegFilled`, and `PlanCompleted` (see `@arbibot/outbox-kafka-bridge`); checklist in [`docs/outbox-inbox.md`](docs/outbox-inbox.md) (profile `bus`, `DATABASE_URL`, `KAFKA_BROKERS`).
- `npm run bus:consume` — build and run smoke consumer with inbox claim (logs `eventName` and `entityType` on successful claim)

Copy [`.env.example`](.env.example) to `.env` and adjust URLs. Typical Nest env: `PORT`, `DATABASE_URL`, `REDIS_URL`, `CORS_ORIGINS`, `KAFKA_BROKERS`, and service-to-service URLs where applicable (e.g. **`RISK_SERVICE_URL`** for `opportunity-service` → risk). **`apps/web`** uses **`RISK_API_BASE`**, **`OPPORTUNITY_API_BASE`**, **`CAPITAL_API_BASE`**, **`EXECUTION_API_BASE`**, **`AUDIT_API_BASE`**, **`PORTFOLIO_API_BASE`**, **`RECONCILIATION_API_BASE`** for upstream HTTP (same defaults as local ports; override per deploy).

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
| portfolio-service | 3016 |
| reconciliation-service | 3017 |

Each service: `npm run start:dev -w @arbibot/<name>` or use root scripts (`dev:risk`, `dev:opportunity`, … in [`package.json`](package.json)).

Shared libraries live under [`packages/`](packages/), especially:

- `@arbibot/contracts`
- `@arbibot/persistence`
- `@arbibot/messaging`
- `@arbibot/nest-database`
- `@arbibot/nest-platform`
- `@arbibot/outbox-kafka-bridge`

### Frontend (`apps/web`)

- Stack conventions (React Query BFF, shadcn-style UI, RSC vs client): [`apps/web/STACK-CONVENTIONS.md`](apps/web/STACK-CONVENTIONS.md).
- Dev: `npm run dev -w @arbibot/web` (Next.js defaults to port **3000**; use another port if a Nest app uses 3000, e.g. `PORT=3001 npm run dev -w @arbibot/web`).
- Lint / build: `npm run lint -w @arbibot/web`, `npm run build -w @arbibot/web`.
- Server-side BFF fetches use **`*_API_BASE`** env vars (`RISK_API_BASE`, `OPPORTUNITY_API_BASE`, `CAPITAL_API_BASE`, `EXECUTION_API_BASE`, `AUDIT_API_BASE`, `PORTFOLIO_API_BASE`, `RECONCILIATION_API_BASE`); see [`apps/web/lib/api-base.ts`](apps/web/lib/api-base.ts) and [`.env.example`](.env.example).

Operator session in dev: see `apps/web` middleware / `getOperatorSession` — `ARBIBOT_DEV_ROLE` or `arbibot_role` cookie.

### Current Phase 1 notes

- `opportunity-service` uses an in-DB relay for `RiskDecisionIssued` only.
- `@arbibot/outbox-kafka-bridge` publishes `SnapshotUpdated`, `CapitalReserved`, `PlanArmed`, `LegFilled`, and `PlanCompleted` to Kafka/Redpanda (filtered `event_type` list) and must not compete with the in-DB relay, which handles only `RiskDecisionIssued`.
- SQL migrations are applied lexicographically by `tools/db-migrate.mjs`; recent migrations include canonical market, market intake idempotency, outbox relay dead-letter fields, execution/portfolio/reconciliation, **token/route profiles and risk decision keys** (`015_token_route_profiles.sql`).
- Canonical registry tables are not auto-seeded; after migrations, `venue_refs`, `canonical_instruments`, and `canonical_routes` must be populated manually before `resolve-*` endpoints return data.

### Phase 2 slice (controlled execution / policy)

- **HTTP venue:** `VENUE_HTTP_BASE_URL` + optional `VENUE_HTTP_TIMEOUT_MS`; lab stand [`tools/lab-venue-stand.mjs`](tools/lab-venue-stand.mjs) (`LAB_VENUE_PORT`); CI Phase 2 chain: `npm run ci:e2e-phase2` / job **`e2e-phase2`**.
- **Risk profiles:** `GET /policy/phase2-readiness`, `GET /policy/token-profiles`, `GET /policy/route-profiles`; `POST /evaluate-risk` optional `instrumentKey` / `routeKey` (DB caps). Roadmap: [`docs/phase2-risk-policy-roadmap.md`](docs/phase2-risk-policy-roadmap.md).
- **Reconciliation P0 procedure** (operator checklist): [`docs/reconciliation-p0-procedures.md`](docs/reconciliation-p0-procedures.md).
- **Metrics:** shared registry via `getArbibotMetricsRegistry()` from `@arbibot/nest-platform` (same registry as `GET /metrics`); orchestrator exposes `arb_execution_leg_partial_fill_commits_total` on partial fills.
- **Observability v0:** SLO/on-call draft in [`docs/observability-tracing.md`](docs/observability-tracing.md).

### CI

[`.github/workflows/ci.yml`](.github/workflows/ci.yml) runs on Node **22**: `npm ci`, then Turbo `lint`, `build`, `test` for the whole monorepo.
