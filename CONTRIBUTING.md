# Contributing to Arbibot 2

Thanks for your interest in contributing! Arbibot 2 is a high-throughput
crypto-arbitrage platform with strict architectural invariants — this guide will
help you land changes that respect them.

## Quick Start for Contributors

```bash
git clone <repo-url> arbibot-2
cd arbibot-2
npm ci
cp .env.example .env
docker compose -f infra/docker-compose.dev.yml up -d
npm run db:migrate
npm run lint && npm run build && npm run test
```

Requirements: **Node.js ≥ 22**, **npm 11+**, Docker, PostgreSQL 16, Redis 7
(both via Docker compose for local dev).

## Project Layout

- `apps/*` — NestJS/Fastify backend services + Next.js operator UI (`apps/web`)
- `packages/*` — shared TypeScript libraries (`contracts`, `persistence`,
  `messaging`, `nest-database`, `nest-platform`, `outbox-kafka-bridge`,
  `hermes-mcp-server`, `contracts-eth`)
- `infra/` — Docker compose, Grafana, Prometheus, Loki, Postgres migrations,
  Nginx, k8s manifests
- `tools/` — E2E scripts, CI wrappers, DB helpers
- `docs/` — architecture specs, runbooks, ADRs, handbook
- `.cursor/plans/` — canonical phased development plan (source of truth for scope)
- `.cursor/rules/` — architecture & verification rules
- `.cursor/skills/` — review skills (architecture-guard, backend-review,
  frontend-review, git-workflow)

## Before Writing Code

1. **Identify the bounded context** — which service owns the entity you're
   touching? Cross-cutting changes need an ADR (`docs/adr-*.md`).
2. **Read the development plan** — `.cursor/plans/DEVELOPMENT_PLAN.md` defines
   the current phase. Phase 6+ features are out of scope and will be rejected.
3. **Read the relevant rules** — `.cursor/rules/arbibot-project.mdc` and
   `.cursor/rules/verification-methodology.mdc`.

## Architectural Invariants (must respect)

Every contribution is reviewed against these — violations are blocking:

- **Single-writer principle** — each core entity
  (`ArbitrageOpportunity`, `RiskDecision`, `ExecutionPlan`, `CapitalReservation`,
  `PortfolioPosition`, `PaperTrade`) has exactly one owning service. Other
  services may read but never write.
- **Reservation-first protocol** — never bypass
  `EvaluateOpportunity → EvaluateRisk → ReserveCapital → ArmPlan → ExecutePlan`.
- **Versioned state transitions** with optimistic concurrency
  (compare-and-set on `version`).
- **Idempotent commit** — fill events and operator actions must be idempotent.
- **Outbox/inbox pattern** — no direct service-to-service writes via shared DB.
- **Reconciliation loop** — system state must be reconcilable with venue/on-chain.
- **Bulkhead isolation** — execution, analytics, paper trading stay isolated.
- **Event envelope** — every event has `messageId`, `correlationId`,
  `causationId`, `entityType`, `entityId`, `version`, `sourceModule`, `eventTs`.

See [`docs/reservation-first.md`](docs/reservation-first.md),
[`docs/outbox-inbox.md`](docs/outbox-inbox.md),
[`docs/state-machines.md`](docs/state-machines.md),
[`docs/aggregates.md`](docs/aggregates.md) for details.

## Tech Stack (do not deviate)

- **Backend:** TypeScript (strict mode, no `any`), NestJS + Fastify, TypeORM
- **Frontend:** Next.js (App Router), React, shadcn/ui, TanStack Table,
  React Query, Zustand
- **Data:** PostgreSQL (primary), Redis (cache), Kafka/Redpanda (events),
  ClickHouse (analytics — Phase 4+)
- **Observability:** Prometheus, Grafana, Loki, OpenTelemetry
- **Runtime:** Node 22+ for orchestration/APIs, Python for analytics jobs

## Coding Rules

### TypeScript / NestJS

- Strict mode always on; no `any` — use proper types or generics.
- DTOs and domain entities are separate; don't mix them.
- Modular structure: Module → Controller (HTTP) → Service (domain) →
  Repository (persistence).
- All HTTP routes must be reflected in OpenAPI draft
  ([`docs/openapi-draft.yaml`](docs/openapi-draft.yaml)) when changed.
- All async events need an AsyncAPI schema entry
  ([`docs/async-events.md`](docs/async-events.md)).

### Frontend

- Use shadcn/ui components; do not introduce new component libraries.
- Server Components by default; client components only for interaction/visuals.
- Server-side fetch via `*_API_BASE` env vars (see [`apps/web/lib/api-base.ts`](apps/web/lib/api-base.ts)).
- Destructive operator actions need **impact preview + two-step approval +
  audit log**.

### Events

- Always include envelope fields.
- Versioned payloads — bump `version` on breaking changes.
- Implement idempotency keys for handlers.
- Event types are allowlisted in publishers (e.g. `@arbibot/outbox-kafka-bridge`).

## Operator Actions & Audit

Any operator mutation (force hedge, force unwind, token suspend/block,
runbook start, promotions, policy changes) must:

1. Produce an audit entry via `AuditClientService.appendEntry`.
2. Show an impact preview (what will change, which plans/positions/tokens).
3. Require two-step approval with audit trail.

See [`docs/operator-approval-flow.md`](docs/operator-approval-flow.md).

## Pull Request Process

1. **Branch name**: `feat/<short>`, `fix/<short>`, `docs/<short>`,
   `chore/<short>` — keep it short and ASCII.
2. **Commit style**: conventional commits preferred
   (`feat(risk): add X`, `fix(execution): handle Y`, `docs: ...`).
   Structured commits linked to plan `step_id` are welcome.
3. **Pre-commit validation** must pass locally:
   ```bash
   npm run lint
   npm run build
   npm run test
   ```
   Optionally run the relevant E2E script from `tools/`.
4. **PR description** must include:
   - **What** changed and **why**.
   - Which architectural invariant(s) apply (single-writer,
     reservation-first, etc.).
   - Which contracts changed (HTTP endpoint, event, DB migration).
   - Migration number if a new SQL file was added (next sequential under
     `infra/postgres/migrations/`).
5. **Review** — expect review against:
   - `.cursor/skills/architecture-guard-agent/SKILL.md`
   - `.cursor/skills/backend-review-agent/SKILL.md` or
     `.cursor/skills/frontend-review-agent/SKILL.md`
6. **Do not force-push** after review — add follow-up commits unless asked.

## Database Migrations

- Sequential numeric prefix: `037_<short>.sql`, `038_<short>.sql`, …
- Always provide a forward path; rollback path is best-effort.
- Never edit an already-merged migration — add a new one.
- After adding a migration, update `npm run db:verify-migrations:all` if needed.

## Tests

- Unit tests: colocated `*.spec.ts` per module.
- E2E: scripts under `tools/e2e-*.mjs`, wrapped by `tools/ci-e2e-*.sh`.
- New E2E job? Add it to `.github/workflows/ci.yml` and document the script
  in `package.json` + README.

## Adding Dependencies

- Production deps must be justified — runtime footprint matters.
- Run `npm audit` and resolve `High`/`Critical` before PR.
- Prefer existing packages in `packages/*` over new external libs.

## Documentation

- Significant backend change → update relevant doc in `docs/`.
- New config key → add to `docs/policy-config-keys-catalog.md` or
  `docs/opportunity-filters-config-keys.md`.
- New ADR-worthy decision → create `docs/adr-<topic>.md`.
- User-visible UI change → screenshot in PR description.

## Code of Conduct

Be respectful and professional. Harassment, personal attacks, and
discriminatory behavior are not tolerated. By participating you agree to
maintain a constructive and welcoming environment for all contributors
regardless of background or experience level.

## Questions?

- Architecture / scope questions: open a Discussion on GitHub.
- Bug reports: GitHub Issues (use the issue template if available).
- Security issues: see [`SECURITY.md`](SECURITY.md) — **never** a public issue.

Thanks for helping make Arbibot 2 better! 🚀