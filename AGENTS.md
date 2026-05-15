
# Arbibot 2

## Cursor / agent instructions

### Arbibot 2 Cursor Skills

The repo uses custom Cursor skills in `.cursor/skills/` for architecture validation and code reviews:

1. **architecture-guard-agent** — validates changes against Arbibot 2 system architecture
   - Path: `.cursor/skills/architecture-guard-agent/SKILL.md`
   - Checks: service boundaries, single-writer, reservation-first, outbox/inbox, reconciliation, paper/live isolation, operator approval for destructive actions, OpenAPI/AsyncAPI consistency
   - Triggers: architecture review, guard check, boundary review, invariant check, ADR review
   - Usage: Run via `/architecture-guard` or when prompted by the system

2. **backend-review-agent** — reviews backend code against Arbibot 2 architecture
   - Path: `.cursor/skills/backend-review-agent/SKILL.md`
   - Checks: NestJS/Fastify services, OpenAPI/AsyncAPI/schema review, single-writer patterns, reservation-first, outbox/inbox, ExecutionPlan state machine, event envelopes
   - Triggers: backend review, PR review, risk service review, contracts review, approve backend PR
   - Usage: Run via `/backend-review` or when requested for backend code review

3. **frontend-review-agent** — reviews frontend code against Arbibot 2 conventions
   - Path: `.cursor/skills/frontend-review-agent/SKILL.md`
   - Checks: Next.js/React review, operator dashboard PR, App Router, React Query, Zustand, shadcn/ui, TanStack Table, operator safety, RBAC, destructive action flows
   - Triggers: frontend review, dashboard review, UI review, operator UX, RBAC review
   - Usage: Run via `/frontend-review` or when requested for frontend code review

4. **git-workflow-agent** — manages Git operations in the Arbibot 2 monorepo
   - Path: `.cursor/skills/git-workflow-agent/SKILL.md`
   - Checks: structured commits linked to plan step_ids, pre-commit validation (build/lint/test), branch naming conventions, conflict resolution, error recovery, Windows path safety, forbidden operations
   - Triggers: git commit, git branch, git merge, git rebase, conflict resolution, git fix, git error, prepare PR, sync branch
   - Usage: Run via `/git-workflow` or automatically on Git operations

**Workflow:** When making changes that cross service boundaries or involve critical flows, use architecture-guard-agent before committing. For PR reviews, use backend-review-agent or frontend-review-agent based on the code area. **For all Git operations (committing, branching, merging, conflict resolution, PR preparation), use git-workflow-agent** to ensure structured commits, pre-commit validation, and correct branch management.

### graphify (knowledge graph)

The repo uses [graphify](https://github.com/safishamsi/graphify): `graphify-out/` is listed in `.gitignore` and is generated locally, not committed.

**Current graph state (2026-04-18, code-only AST refresh):** **754** nodes, **634** edges, **230** communities — details in `graphify-out/GRAPH_REPORT.md` (276 TypeScript/TS source files scanned).

- Install once: `python -m pip install graphifyy`, then from the repo root `python -m graphify cursor install` (writes [`.cursor/rules/graphify.mdc`](.cursor/rules/graphify.mdc)).
- **Code-only refresh (AST, no LLM):** `python -c "from graphify.watch import _rebuild_code; from pathlib import Path; _rebuild_code(Path(\'.\'))"` — updates `graphify-out/graph.json`, `GRAPH_REPORT.md`, and cache; use after code edits for a quick graph sync. On Windows if `python` is not on `PATH`, use the same one-liner with **`py -3`** instead of `python`.
- **Full graph (docs, markdown, images, semantic edges):** in Cursor run `/graphify .` (skill); after large doc changes use `/graphify . --update` per graphify docs.
- **Focused questions:** `python -m graphify query "<question>" --graph graphify-out/graph.json`
- For architecture questions, read `graphify-out/GRAPH_REPORT.md` first when that directory exists.

### Overview

Arbibot 2 is a **Turborepo monorepo** (`npm` workspaces: `apps/*`, `packages/*`):

- **Backend:** multiple NestJS HTTP services on **Fastify** + **TypeORM** (PostgreSQL), optional Redis, Prometheus metrics via `@arbibot/nest-platform`.
- **Operator UI:** Next.js App Router in **`apps/web`** (`@arbibot/web`).

There is **no** `core-backend/` or `operator-frontend/` directory; older docs or audits may refer to that layout.

**Current status (2026-04-28):**
- **Phase 4 (complete — all formal `P4-4-*` steps `done` in [DEVELOPMENT_PLAN](.cursor/plans/DEVELOPMENT_PLAN.md)):** market-intake — **`PolicyCacheService`**, **`IntakeThrottleService`**, **`DegradationStateService`**, metrics `arb_intake_*`, **`GET /health`**, **`GET /health/degradation`**, throttling via `INTAKE_THROTTLING_ENABLED`, **429** with explicit JSON on throttle, config keys `intake.throttling` / `intake.routing.tiers` (tier priority: instrumentKey lists → fallback watchlist tiers); CI smoke **`e2e-phase4-tier-routing`** / `npm run ci:e2e-phase4-tier-routing`; **`P4-4-SCORE`** — [`docs/route-scoring-replay.md`](docs/route-scoring-replay.md), `npm run replay:route-scoring-export`; **`P4-4-CH`** — [`docs/adr-phase4-clickhouse-gate.md`](docs/adr-phase4-clickhouse-gate.md), analytics path latency in [`docs/observability-tracing.md`](docs/observability-tracing.md); bridge docs — [`docs/phase4-prep-bridge.md`](docs/phase4-prep-bridge.md), ADR throttling — [`docs/adr-phase4-intake-throttling.md`](docs/adr-phase4-intake-throttling.md); UI — **`DegradedStatusBanner`**, intake on `/dashboard`, BFF **`GET /api/operator/health/degradation`**, **`MARKET_INTAKE_API_BASE`**; Grafana intake panels on `arbibot-risk-policy-writers.json`; **[`docs/intake-degradation-runbook.md`](docs/intake-degradation-runbook.md)**; P2 prep — **`docs/paper-promotion-quality-criteria.md`**, **`tools/recalibration/`** stub
- **Phase 5 (OpenClaw — formal steps `done` per plan):** **`apps/openclaw-gateway`** **`GET/POST/PATCH /openclaw/v1/*`** (mutations audited; rate limit per API key; incident briefs / approvals queue / safe-mode where implemented), BFF **`/api/operator/openclaw/v1/[[...path]]`**, **`/openclaw`** UI, **`npm run dev:openclaw`**, **[`apps/openclaw-gateway/README.md`](apps/openclaw-gateway/README.md)**, **[`docs/openclaw-gateway-runbook.md`](docs/openclaw-gateway-runbook.md)**, **`docs/openclaw-operator-api-spec.md`**, **`docs/openclaw-ui-design.md`**, **`docs/openclaw-safe-mode-runbook.md`**, **`docs/ci-verification-checklist.md`**, **`docs/e2e-scenarios.md`**
- **Phase 2.2 short-term slice:** risk-service — token/route profile services, **`adaptiveRisk`** on `POST /evaluate-risk`, read APIs **`GET /policy/watchlist/tiers`**, **`GET /policy/route-scoring-history/:routeKey`**, **policy writer jobs** (`WatchlistTieringWriterService` / `RouteScoringWriterService`, optional `RISK_POLICY_JOBS_ENABLED`, **`POST /policy/jobs/watchlist-tiering`**, **`POST /policy/jobs/route-scoring`** with `x-arbibot-job-trigger` + `RISK_POLICY_JOB_TRIGGER_TOKEN`); docs **`docs/watchlist-tiering-logic.md`**, **`docs/route-scoring-logic.md`**; smoke **`npm run e2e:phase2-watchlist-route-scoring`**; CI — **`e2e-phase2-watchlist-route-scoring`** job, **`tools/ci-e2e-phase2-watchlist-route-scoring.sh`**, Grafana **`arbibot-risk-policy-writers.json`** with writer metrics; execution-orchestrator — **`playbook_config`** + `PartialFillPlaybookService`; paper-trading — promotion **`qualityTier`** / **`qualityScore`**, drift samples optional **`routeKey`**; **`tools/recalibration/`**; docs **`partial-fill-playbooks.md`**, **`recalibration-spec.md`**, **`paper-promotion-criteria.md`**; observability — histogram bucket reference in **`docs/observability-tracing.md`**; operator UI — **`/settings`** → «Watchlist tiers» + «Route scoring history», BFF **`GET /api/operator/settings/watchlist-tiers`**, **`GET /api/operator/settings/route-scoring/[routeKey]`**, offline export **`tools/export-route-scoring-history.mjs`**, **`npm run export:route-scoring-history`**
- **Last major update (2026-05-14):** DEX план — **33/35 шагов → `done`**; DEX-1.4 — BNB Chain (PancakeSwap V2 + Biswap V2, [`docs/dex-bnb-runbook.md`](docs/dex-bnb-runbook.md), `tools/e2e-dex1-bnb-testnet.mjs`) → done; DEX-1.4 — Arbitrum (UniV2/V3/Sushi, [`docs/dex-arbitrum-runbook.md`](docs/dex-arbitrum-runbook.md), `tools/e2e-dex1-arbitrum-testnet.mjs`, Sepolia chainId fix 421613→421614) → done; DEX-1.4 — Base ([`docs/dex-base-runbook.md`](docs/dex-base-runbook.md), chainId fix 84531→84532, primary venue: Uniswap V3) → done; DEX-1.3 — PAPER-MAINNET → done; DEX-1-3-LIVE-MAINNET → done ([`docs/dex-live-mainnet-runbook.md`](docs/dex-live-mainnet-runbook.md)); DEX-1-2-HEALTH + DEX-1-2-OBS → done (`DexHealthService`, `DexMetricsService`, `GET /health/dex`, Grafana `arbibot-dex-overview.json`, BFF `/api/operator/health/dex`, `DexHealthBanner`); DEX-1-2-LOAD-TEST → done (`tools/dex-load-test.mjs`); Lint 28/28 ✅, Build 21/21 ✅; **следующие шаги: `DEX-DOC-FE`, `DEX-DOC-RUNBOOK-TX`**
- **Bus-smoke verification (2026-04-19):** connection tests successful — Docker compose --profile bus running (Redpanda port 19092), `@arbibot/outbox-kafka-bridge` built, publisher/consumer connected to Kafka (consumer group: `arbibot-bus-smoke`), all artifacts from `docs/outbox-inbox.md` checklist verified
- **CFG-3 UI in `/settings`:** promote/activate draft completed (promote/activate draft workflows with React Query, draft checkboxes, Promote modal, `DestructiveOperatorAction` integration)
- **Paper discovery × config-service integration:** effective JSON on key `paper.discovery` with cache, env fallback, single-writer pattern respected
- **Review gate checklist:** [`docs/review-gate-cfg3-paper-discovery.md`](docs/review-gate-cfg3-paper-discovery.md) — backend/frontend/architecture checks passed
- **Phase 0–2** (foundation + controlled execution): completed
- **Phase 3** (paper trading): basic slice implemented (paper-trading-service, UI `/paper`, `/tokens`, `POST /opportunities/:id/paper-enqueue`)
- **Config service (CFG-1, CFG-2, CFG-3 slice):** implemented (NestJS + Fastify, Redis cache, audit, scopes / effective / history / rollback; **CFG-3 UI** completed — promote/activate draft in `/settings`; remaining CFG-3 backlog — [.cursor/plans/DEVELOPMENT_PLAN.md](.cursor/plans/DEVELOPMENT_PLAN.md))
- **Operator dashboards M2 (PRIO-P1-DASH):** completed (dashboard summary with incidents/capital widgets)
- **Paper quality improvements:** completed (Grafana dashboards, drift alerts v1/v2, SLO v1)
- **Paper Trading Complete (P3-1, P3-2, P3-3, P3-5, P3-6):** completed (paper trades mutations, promotion candidates mutations, virtual capital, drift gauges, E2E tests)
- **Paper Discovery Pipeline (P3-4):** implemented (discovery worker, candidate entity, E2E tests, **config-service integration**, bug fixes for entity ID handling)
- **Migrations:** 001–035 (в т.ч. **`024_fix_rollback_configuration_function.sql`**, **`025_execution_plan_playbook.sql`**, **`026_watchlist_tier_snapshots.sql`**, **`027_route_scoring_history.sql`**, **`028_paper_drift_route_key.sql`**, **`029_intake_policy_seed.sql`** — defaults `intake.throttling` / `intake.routing.tiers`; **`030_paper_promotion_quality_fields.sql`**, **`031_portfolio_position_close_idempotency.sql`**, **`032_dex_filters_seed.sql`** — DEX opportunity filters seed; **`033_dex_on_chain.sql`** — on-chain transactions, wallet states, DEX pools, approvals; **`034_on_chain_tx_leg_id_uuid.sql`** — OnChainTransaction.legId bigint→uuid; **`035_dex_live_limits_seed.sql`** — seed `dex.limits` + `dex.live` config); policy scope **`020_policy_configuration_scopes.sql`** (исправленный rollback / совместимость)
- **DEVELOPMENT_PLAN:** Phase 4 **`P4-4-*`** steps **`done`** (as of **2026-04-20**), including **`P4-4-SCORE`** ([`docs/route-scoring-replay.md`](docs/route-scoring-replay.md), `npm run replay:route-scoring-export`) and **`P4-4-CH`** ([`docs/adr-phase4-clickhouse-gate.md`](docs/adr-phase4-clickhouse-gate.md), analytics path latency in [`docs/observability-tracing.md`](docs/observability-tracing.md)); **`PRIO-P2-PAPERDISC`**, **`PRIO-P2-TIER`**, **`PRIO-P2-SCORE`** → **`done`**; **`P5-5-GW`**, **`P5-5-OAPI`**, **`P5-5-OCUI`**, **`P5-5-BRIEF`** → **`done`** — see [.cursor/plans/DEVELOPMENT_PLAN.md](.cursor/plans/DEVELOPMENT_PLAN.md) for any new backlog items

**Known issues:**
- ✅ **DEX Integration — 3 блокера исправлены (2026-04-29):**
  1. `getEncryptedKey` реализован в WalletManager (делегирует к KeyVaultService)
  2. `ExecutionModule` создан, DI-регистрация `WalletManagerService` + `KeyVaultModule` + `WalletState`
  3. `KeyVaultService` переписан: aes-256-gcm, Buffer для crypto, hex для storage
  - **Unit tests:** 20/20 passed (`key-vault.service.spec.ts`)
  - **Build:** 21/21 пакетов green (включая новый `@arbibot/contracts-eth`)
- ✅ **DEX-1-0-TECH-CHOICE + DEX-1-0-ABIS → done (2026-04-29):**
  - `ethers.js v6.13.0` выбран как EVM library
  - Пакет `@arbibot/contracts-eth` создан (ABI UniV2/V3/Sushi + ERC20, адреса Arbitrum/Base/BNB, типы ChainId/Address)
  - DEX план v1.1, миграция DEX-1-0-MIGRATIONS перенумерована в `033`
- `FE-SETTINGS-POLICY-WORKSPACE` → `implemented`, awaiting `/review-step` → `done`
- CI зелёный на GitHub Actions не верифицирован (локально lint 28/28 ✅, build 21/21 ✅)
- Недостающие unit-тесты: `PoolDiscoveryService`, `RpcProviderManager` (частично)
- Migration **020** rollback path repaired via **`024`**; применяйте миграции по порядку на чистых БД

### DEX Code Review & Filters (2026-04-28)

**DEX Opportunity Filters System (DEX-1-0-FILTERS):**
- Backend (`opportunity-service`): `DexFiltersConfigDto`, методы `applyDexFilters()`, `previewDexFilters()`, `getDexFiltersMetrics()`
- Frontend: `DexFiltersPanel`, BFF routes для preview/metrics
- Migration: `032_dex_filters_seed.sql`
- Documentation: [`docs/dex-filters-config-keys.md`](docs/dex-filters-config-keys.md)
- Типы фильтров: threshold (spread, profit, fees), volume, tokens, risk
- SLO: Filter application < 10ms, Preview < 100ms

**DEX Code Review — блокеры (все исправлены 2026-04-29):**
- ✅ Blocker 1: `getEncryptedKey` реализован (делегирует к KeyVaultService)
- ✅ Blocker 2: `ExecutionModule` создан с DI-регистрацией всех сервисов
- ✅ Blocker 3: `KeyVaultService` переписан (aes-256-gcm, Buffer для crypto)
- Task Management Policy: DEX задачи → `.cursor/plans/DEVELOPMENT_PLAN-DEX.md`, остальные → `docs/TODO.md`

**FE-SETTINGS-POLICY-WORKSPACE (`implemented`):**
- Вкладки `/settings`: Overview, All policies, Intake, Paper discovery, Extensions catalog, Diagnostics
- URL context для effective (`environment`, `tenantId`)
- Реестр policy-ключей + Zod валидация (`apps/web/lib/policy-config-registry.ts`)
- Docs: `docs/policy-config-keys-catalog.md`, `docs/opportunity-filters-config-keys.md`
- Awaiting: `/review-step` → `done`

### Last session details (2026-04-19)

**Bus-smoke verification:**
- Docker compose --profile bus запущен (Redpanda на порту 19092)
- `@arbibot/outbox-kafka-bridge` успешно собран
- Publisher verification: `npm run start:publish` запущен с переменными окружения (`KAFKA_BROKERS`, `DATABASE_URL`)
- Consumer verification: `npm run start:consume` запущен и подключился к Kafka:
  - Consumer group: `arbibot-bus-smoke`
  - Member ID: `arbibot-outbox-consumer-90b69e03-4491-4fe2-a91e-ea9a2eb71f5a`
  - Topic: `arbibot.domain.events` (partition 0)
- Проверенные артефакты (по чеклисту из `docs/outbox-inbox.md`):
  - Entrypoints: `dist/bin/publish.js`, `dist/bin/consume.js` — подтверждены
  - Фильтр event_type: `KAFKA_PUBLISH_EVENT_TYPES` — соответствует документации (`SnapshotUpdated`, `CapitalReserved`, `PlanArmed`, `LegFilled`, `PlanCompleted`)
  - Smoke-consumer логирование: `eventName`, `entityType`, `correlationId` — подтверждены в коде
  - Env vars: `DATABASE_URL`, `KAFKA_BROKERS`, `KAFKA_TOPIC` — все обработаны

**Review gate PRIO-P2-PAPERDISC (closed):**
- Backend review: effective `paper.discovery`, кэш, env fallback, single-writer
- Frontend: `/settings` проверен
- Architecture: paper ↔ config read-only HTTP
- Observability: `installMetricsOnFastify` + `serviceName` во всех `apps/*/src/main.ts`
- Исправлен bug в `PaperDiscoveryService.runDiscoveryCycle` — обработка eligible-кандидатов по `id` сущностей из `create()`, а не по несуществующему `DiscoveryCandidate.id`
- Persistence: в `PaperDiscoveryCandidateEntity` добавлены колонки `token_key`/`route_key`; исправлен `@Index` на `created_at`; `paper-capital-reservation`: удалён недопустимый для TypeORM `check` в `@Column`
- Worker: Prometheus-метрики привязаны к `getArbibotMetricsRegistry()` через `registers: []`; удалены `ScheduleModule` и зависимость `@nestjs/schedule`; интервал через `setInterval` + `unref`/`clearInterval` в `onModuleDestroy`; метрика переименована в `arb_paper_discovery_processed_total`
- Тесты: моки `AuditClientService`/`PaperCapitalService` в `paper-trades`/`paper-promotion` specs; `paper-discovery.worker.spec` с `getArbibotMetricsRegistry().clear()` в `beforeEach`
- `DEVELOPMENT_PLAN.md`: `PRIO-P2-PAPERDISC` → `done` (с записью review)

**Monorepo ESLint (fixed):**
- Все 19 пакетов прошли ESLint check
- Исправлены ошибки в config-service и web:
  - `configurations.service.ts`: проверка `latest.is_active` без лишнего `Boolean()`
  - `promote-configuration.dto.ts`: удалён неиспользуемый импорт `IsNotEmpty`
  - `configurations.service.spec.ts`: `appendEntry` как отдельный `jest.fn()`
  - `paper-trades/[id]/route.ts`: удалён неиспользуемый импорт
  - `paper-promotion-table.tsx`, `paper-trades-table.tsx`: `handleAction` в `useCallback`, зависимости колонок в `useMemo`

**Open questions:**
- Full E2E bus-smoke с запущенными сервисами и сообщениями в топике отложен до необходимости
- Для полной проверки end-to-end с сообщениями в топике требуются сервисы с сгенерированными outbox_events (future)

**Phase 4 — implementation reference (2026-04-20–21):**
- **market-intake throttling:**
  - `PolicyCacheService` — policy cache via HTTP to config-service (`GET /policy/configurations/*/effective`) + risk `watchlist/tiers` + optional `route-scoring-history/:routeKey` (read-only, single-writer: risk-service)
  - `IntakeThrottleService` — throttling logic with env `INTAKE_THROTTLING_ENABLED`; returns **429** + explicit JSON `{ throttled: true }` on throttle (not silent drop); optional audit on `requireAuditOnThrottle` in `intake.throttling` JSON
  - `DegradationStateService` — tracks fallback mode, metrics `arb_intake_degradation_active`, `arb_intake_degradation_duration_seconds`
  - Metrics: `arb_intake_throttled_total`, `arb_intake_samples_recorded_total`, `arb_intake_samples_dropped_total`, `arb_intake_tier_routing_total` (label: tier)
  - Health: `GET /health/degradation` — returns `{ degraded, fallbackMode, degradationReasons }`
  - Config JSON keys: `intake.throttling` (enabled, samplesPerSecond, requireAuditOnThrottle), `intake.routing.tiers` (priority list of instrumentKey arrays + sampling intervals)
  - README: `apps/market-intake-service/README.md`; tests: `policy-cache.service.spec.ts`
- **degraded UI signals:**
  - `apps/web`: BFF `GET /api/operator/health/degradation` (proxy to market-intake), `DegradedStatusBanner` component (polling 30s), dashboard intake section
  - Query keys: `operatorKeys.intakeDegradation`, `operatorKeys.dashboardSummary`
  - Styling: warning banner in operator layout with dismiss option
- **Phase 4 bridge / ADR docs:**
  - `docs/phase4-prep-bridge.md` — CI, observability, offline export plan
  - `docs/adr-phase4-intake-throttling.md` — ADR for throttling architecture
  - `docs/phase4-ui-degraded-signals.md` — degraded signals design
  - `docs/paper-promotion-quality-criteria.md` — promotion quality criteria
  - `docs/openclaw-operator-api-spec.md` — OpenClaw API specification
- **Grafana:**
  - `infra/grafana/dashboards/arbibot-risk-policy-writers.json` — intake panels added
  - `infra/grafana/README.md` — updated with intake metrics
- **P2 prep:**
  - `tools/recalibration/main.py` — stub Python CLI, JSON output only
  - `tools/recalibration/README.md` — recalibration spec
- **Phase 5 OpenClaw (`P5-5-GW` done):**
  - `apps/openclaw-gateway/` — Nest+Fastify, port 3020; **`OpenclawAuthGuard`** + **`GET /openclaw/v1/plans`**, **`plans/:id`** (plan+legs), **`positions`**, **`incidents`**, **`dashboard/summary`**
  - `GET /health` — basic health; `GET /health/operator-bff` — BFF probe when `OPERATOR_WEB_BFF_BASE` set
  - `apps/web`: **`GET /api/operator/openclaw/v1/*`** BFF → gateway (`OPENCLAW_GATEWAY_URL`, `OPENCLAW_BFF_API_KEY`); **`/openclaw`** page shows read-only summary + sample plans when configured
  - `npm run dev:openclaw` — dev command; Jest tests: `openclaw-auth.guard.spec.ts`
  - Docs: [`apps/openclaw-gateway/README.md`](apps/openclaw-gateway/README.md), [`docs/openclaw-gateway-runbook.md`](docs/openclaw-gateway-runbook.md)
- **Env vars:**
  - `MARKET_INTAKE_API_BASE` — for web BFF
  - `INTAKE_THROTTLING_ENABLED` — feature flag
  - `INTAKE_POLICY_CACHE_MS` — policy cache TTL
  - `OPENCLAW_GATEWAY_PORT` — OpenClaw port (default 3020)
  - `OPENCLAW_API_KEYS` — comma-separated keys for `x-openclaw-api-key` on **`openclaw-gateway`**
  - `OPENCLAW_GATEWAY_URL` + `OPENCLAW_BFF_API_KEY` — **`apps/web`** server-only BFF to gateway
  - `EXECUTION_API_BASE`, `PORTFOLIO_API_BASE`, `RECONCILIATION_API_BASE` — gateway upstream defaults
  - `OPERATOR_WEB_BFF_BASE` — for OpenClaw gateway read-through + health probe

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

**Postgres host port (dev compose):** `infra/docker-compose.dev.yml` maps Postgres to host port **15432** (`15432:5432`) so a separate PostgreSQL on **localhost:5432** does not intercept `DATABASE_URL`. Match [`.env.example`](.env.example) (`127.0.0.1:15432`). CI (GitHub Actions) still uses the service container on **5432** inside the job.

**Windows and Nest apps:** (1) **`nest start` / watch:** keep **`@nestjs/cli` 11.0.21+** and prefer **local** `npm` scripts, not a global `nest` binary ([`nestjs/nest-cli#2358`](https://github.com/nestjs/nest-cli/issues/2358)). (2) **No `dist/main.js` after a “successful” build:** check `cwd` (artefacts are under `apps/<service>/dist/`), run **`npm run build -w @arbibot/<name>`** from the repo root, and compare with a direct `npx tsc -p apps/<service>/tsconfig.build.json` if in doubt. **In this monorepo**, Nest app **`build`** / **`start`** / **`start:dev`** use **`tsc -p tsconfig.build.json`**, **`node dist/main.js`**, and a **`concurrently` + `tsc --watch` + `node --watch`** dev loop so the CLI does not need to wrap `node` for normal local runs; **`nest-cli.json`** uses **“builder”: “tsc”** (and you can still run **`npx nest build`** in a package if you need the CLI).
Use [`.env.example`](.env.example) as the source of truth for local env vars (`DATABASE_URL`, `REDIS_URL`, `CORS_ORIGINS`, `KAFKA_BROKERS`, `ARBIBOT_DEV_ROLE`, optional **`ARBIBOT_DEV_OPERATOR_ID`** for config-service audit in BFF). For **`apps/web`** server-side BFF proxies, use **`*_API_BASE`** (see [`apps/web/lib/api-base.ts`](apps/web/lib/api-base.ts)), including **`CONFIG_API_BASE`**, **`PORTFOLIO_API_BASE`**, **`RECONCILIATION_API_BASE`**, **`PAPER_API_BASE`**, and **`MARKET_INTAKE_API_BASE`**.

### Root workspace

From the repo root:

- `npm ci` — install all workspaces
- `npm run lint` — Turbo lint (Nest apps, packages, `apps/web`)
- `npm run build` — Turbo build
- `npm run test` — Turbo test
- `npm run db:migrate` — apply SQL migrations under `infra/postgres/migrations/` (001–033)
- `npm run e2e:phase1-foundation` — HTTP smoke for Phase 1 DoD §50.3 (snapshot → opportunity → risk → reserve → arm); optional `E2E_INCLUDE_EXECUTION_LEG=true` extends through `apply-fill`; requires migrated DB and running `market-intake`, `opportunity`, `risk`, `capital`, `execution-orchestrator` (see `tools/e2e-phase1-foundation-chain.mjs` for ports / env overrides)
- `npm run e2e:phase2-controlled-execution` — extends the Phase 1 chain through **all** execution legs until the plan is `completed` (see `tools/e2e-phase2-controlled-execution.mjs`); use `EXECUTION_BEGIN_LEG_COUNT` on **execution-orchestrator** for multi-leg; optional settlement envs as in `docs/settlement-post-commit.md`
- `npm run e2e:phase2-watchlist-route-scoring` — seeds `token_profiles` / `route_profiles` / `risk_decisions` via `DATABASE_URL`, triggers **`POST /policy/jobs/*`** on **risk-service** (`RISK_SERVICE_URL`, `RISK_POLICY_JOB_TRIGGER_TOKEN`); see `tools/e2e-phase2-watchlist-route-scoring.mjs`
- `npm run e2e:phase3-paper-promotion` — smoke: create opportunity → `paper-enqueue` (dedup) → poll paper **`/paper/promotion-candidates`** until relay delivers (see `tools/e2e-phase3-paper-promotion.mjs`); requires migrated DB (**`018`**), **paper-trading-service**, **opportunity-service** with **`PAPER_TRADING_SERVICE_URL`** set to paper base URL; script waits for **`GET /metrics`** on both services first
- `npm run ci:e2e-phase3` — CI wrapper: Postgres + **paper-trading-service** + **opportunity-service** with fast **`OUTBOX_RELAY_POLL_MS`**, then `e2e:phase3-paper-promotion` (see `tools/ci-e2e-phase3-paper-promotion.sh`); GitHub Actions job **`e2e-phase3-paper-promotion`**
- `npm run ci:e2e-phase3-paper-discovery` — CI: Postgres + **paper-trading-service** + **market-intake-service** + `node tools/e2e-p3-paper-discovery.mjs` (`tools/ci-e2e-phase3-paper-discovery.sh`); GitHub Actions job **`e2e-phase3-paper-discovery`**
- `npm run ci:e2e-phase2` — same Phase 2 HTTP chain with **Postgres + lab HTTP venue + built Nest apps** (see `tools/ci-e2e-phase2.sh`); GitHub Actions runs this as job **`e2e-phase2`** after `npm run build`
- `npm run ci:e2e-phase2-watchlist-route-scoring` — Postgres + **risk-service** + `e2e:phase2-watchlist-route-scoring` (see `tools/ci-e2e-phase2-watchlist-route-scoring.sh`); GitHub Actions job **`e2e-phase2-watchlist-route-scoring`**
- `npm run e2e:phase4-tier-routing` — Phase 4 intake tier routing + warm sampling throttle (requires `INTAKE_THROTTLING_ENABLED=true`, running **risk-service**, **config-service**, **market-intake**); see `tools/e2e-phase4-tier-routing.mjs`
- `npm run ci:e2e-phase4-tier-routing` — Postgres + risk + config + market-intake + `e2e:phase4-tier-routing` (`tools/ci-e2e-phase4-tier-routing.sh`); GitHub Actions job **`e2e-phase4-tier-routing`**
- `npm run seed:intake-policy-config` — HTTP upsert `intake.*` keys via config-service (`tools/seed-intake-policy-config.mjs`; config may need `AUDIT_CLIENT_ENABLED=false` if audit is down)
- `npm run ci:bus-smoke` — build `@arbibot/outbox-kafka-bridge` + optional Docker `--profile bus` (`tools/ci-bus-smoke.sh`); GitHub Actions job **`bus-smoke`**; optional `SEED_OUTBOX=1` with `DATABASE_URL` runs [`tools/seed-outbox-events.mjs`](tools/seed-outbox-events.mjs)
- `npm run seed:outbox-smoke-events` — insert one `SnapshotUpdated` row into `outbox_events` for manual bus publish tests
- `npm run seed:outbox-smoke-events:all` — insert one row per Kafka bridge `event_type` (`SnapshotUpdated`, `CapitalReserved`, `PlanArmed`, `LegFilled`, `PlanCompleted`) for full bus smoke
- `npm run db:verify-migrations` — verify `schema_migrations` contains **030** and **031** (override list: `node tools/verify-migrations-applied.mjs <file.sql> ...`)
- `npm run db:verify-migrations:all` — verify **all** `infra/postgres/migrations/*.sql` rows exist (same as `node tools/verify-migrations-applied.mjs --all`)
- `npm run venue:load-test` — concurrent HTTP venue submits (`VENUE_HTTP_BASE_URL`, optional `VENUE_LOAD_CONCURRENCY`, `VENUE_LOAD_REQUESTS`)
- `npm run export:route-scoring-history` — JSONL/CSV export from `route_scoring_history` for offline replay prep (`DATABASE_URL`, optional `ROUTE_KEY`, `LOOKBACK_HOURS`, `FORMAT`)
- `npm run replay:route-scoring-export` — summarize or compare JSONL exports (`summary [file]` reads stdin if omitted; `compare <before> <after>`); see [`docs/route-scoring-replay.md`](docs/route-scoring-replay.md)
- `npm run bus:publish` — build and publish outbox rows to Kafka/Redpanda for `SnapshotUpdated`, `CapitalReserved`, `PlanArmed`, `LegFilled`, and `PlanCompleted` (see `@arbibot/outbox-kafka-bridge`); checklist in [`docs/outbox-inbox.md`](docs/outbox-inbox.md) (profile `bus`, `DATABASE_URL`, `KAFKA_BROKERS`).
- `npm run bus:consume` — build and run smoke consumer with inbox claim (logs `eventName` and `entityType` on successful claim)

Copy [`.env.example`](.env.example) to `.env` and adjust URLs. Typical Nest env: `PORT`, `DATABASE_URL`, `REDIS_URL`, `CORS_ORIGINS`, `KAFKA_BROKERS`, and service-to-service URLs where applicable (e.g. **`RISK_SERVICE_URL`** for `opportunity-service` → risk; **`REDIS_URL`** also for **config-service** cache; optional **`PAPER_TRADING_SERVICE_URL`** for `opportunity-service` → paper promotion enqueue). **`apps/web`** uses **`RISK_API_BASE`**, **`OPPORTUNITY_API_BASE`**, **`CAPITAL_API_BASE`**, **`EXECUTION_API_BASE`**, **`AUDIT_API_BASE`**, **`CONFIG_API_BASE`**, **`PORTFOLIO_API_BASE`**, **`RECONCILIATION_API_BASE`**, **`PAPER_API_BASE`**, **`MARKET_INTAKE_API_BASE`** for upstream HTTP (same defaults as local ports; override per deploy).

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
| openclaw-gateway | 3020 (`OPENCLAW_GATEWAY_PORT`) |
| portfolio-service | 3016 |
| reconciliation-service | 3017 |
| paper-trading-service | 3018 |
| config-service | 3019 |

Each service: `npm run start:dev -w @arbibot/<name>` or use root scripts in [`package.json`](package.json): `dev:risk`, `dev:opportunity`, `dev:capital`, `dev:execution`, `dev:audit`, `dev:canonical`, `dev:intake`, `dev:portfolio`, `dev:reconciliation`, `dev:paper`, **`dev:config`**, **`dev:openclaw`**, `dev:web`.

Shared libraries live under [`packages/`](packages/), especially:

- `@arbibot/contracts`
- `@arbibot/contracts-eth` — EVM ABI, addresses, chain types (DEX)
- `@arbibot/persistence`
- `@arbibot/messaging`
- `@arbibot/nest-database`
- `@arbibot/nest-platform`
- `@arbibot/outbox-kafka-bridge`

### Frontend (`apps/web`)

- Stack conventions (React Query BFF, shadcn-style UI, RSC vs client): [`apps/web/STACK-CONVENTIONS.md`](apps/web/STACK-CONVENTIONS.md).
- Dev: `npm run dev -w @arbibot/web` (Next.js defaults to port **3000**; use another port if a Nest app uses 3000, e.g. `PORT=3001 npm run dev -w @arbibot/web`).
- Lint / build: `npm run lint -w @arbibot/web`, `npm run build -w @arbibot/web`.
- Server-side BFF fetches use **`*_API_BASE`** env vars (`RISK_API_BASE`, `OPPORTUNITY_API_BASE`, `CAPITAL_API_BASE`, `EXECUTION_API_BASE`, `AUDIT_API_BASE`, **`CONFIG_API_BASE`**, `PORTFOLIO_API_BASE`, `RECONCILIATION_API_BASE`, `PAPER_API_BASE`, **`MARKET_INTAKE_API_BASE`**); see [`apps/web/lib/api-base.ts`](apps/web/lib/api-base.ts) and [`.env.example`](.env.example).

#### BFF Routes
- **Dashboard:** `/api/operator/dashboard/summary` (incidents open/resolved today, capital positions count, total notional USD, intake degradation status — Phase 4)
- **Paper trades mutations:** `/api/operator/paper/trades/[id]?action=approve|reject|cancel`
- **Paper promotion candidates mutations:** `/api/operator/paper/promotion-candidates/[id]?action=approve|reject`
- **Settings (config-service):**
  - `/api/operator/settings/configurations` (list, create)
  - `/api/operator/settings/configurations/[configKey]` (get, update)
  - `/api/operator/settings/configurations/[configKey]/effective` (**GET** — resolved value with scope fallback; query `environment`, `tenantId`)
  - `/api/operator/settings/configurations/[configKey]/history` (version history)
  - `/api/operator/settings/configurations/[configKey]/rollback` (rollback to prior version)
  - `/api/operator/settings/configurations/[configKey]/promote` (CFG-3: scope promotion)
  - `/api/operator/settings/configurations/[configKey]/status` (CFG-3: activate draft — `PATCH`)
  - `/api/operator/settings/watchlist-tiers` (read-only: **GET** → risk `GET /policy/watchlist/tiers`)
  - `/api/operator/settings/route-scoring/[routeKey]` (read-only: **GET** → risk `GET /policy/route-scoring-history/:routeKey`)
- **Health (Phase 4 intake):**
  - `/api/operator/health/degradation` (read-only: **GET** → market-intake `GET /health/degradation` — returns `{ degraded, fallbackMode, degradationReasons }`)
- **Health (DEX):**
  - `/api/operator/health/dex` (read-only: **GET** → execution-orchestrator `GET /health/dex` — composite DEX health: RPC, wallet, gas, pool discovery)
- **OpenClaw (Phase 5 read-through + mutations):**
  - `/api/operator/openclaw/v1/[[...path]]` (**GET** / **POST** / **PATCH** → `OPENCLAW_GATEWAY_URL/openclaw/v1/...` with server `OPENCLAW_BFF_API_KEY`; proxies reads + mutations; **POST/PATCH** require operator session and inject `operatorId`)

- UI routes: `/dashboard`, `/portfolio`, `/opportunities`, `/execution`, `/tokens`, `/paper`, `/incidents`, `/runbooks`, `/openclaw`, **`/settings`** (policy configurations via config-service BFF). Phase 3 slice: `/paper` and `/tokens` include paper trades, promotion candidates, drift samples, discovery candidates with proper mutation flows and operator safety.

Operator session in dev: see `apps/web` middleware / `getOperatorSession` — `ARBIBOT_DEV_ROLE` or `arbibot_role` cookie.

### Current Phase 1 notes (2026-04-19)

- **`opportunity-service` in-DB outbox relay** (`OutboxRelayService`): forwards **`RiskDecisionIssued`** and **`PaperPromotionCandidateRequested`** to **paper-trading-service** over HTTP when `PAPER_TRADING_SERVICE_URL` is set (enqueue is **outbox-first** — no synchronous "fire POST from the handler" path for promotion). Relay and bridge each use their own **event-type allowlists**; do not assume Kafka covers relay-only types.
- **`@arbibot/outbox-kafka-bridge`** publishes `SnapshotUpdated`, `CapitalReserved`, `PlanArmed`, `LegFilled`, and `PlanCompleted` to Kafka/Redpanda (filtered `event_type` list). It is a **separate** publisher from the opportunity in-DB relay; keep filters documented and avoid double-publishing the same logical delivery. See [`docs/outbox-inbox.md`](docs/outbox-inbox.md).
- SQL migrations are applied lexicographically by `tools/db-migrate.mjs`; current migrations **001–033** include: canonical market, market intake idempotency, outbox relay dead-letter fields, execution/portfolio/reconciliation, fill/idempotency, **token/route profiles and risk decision keys** (`015_token_route_profiles.sql`), **paper trading** (`016_paper_trading.sql`, `017_paper_promotion_enqueue_idempotency.sql`), **outbox dedup for `paper-enqueue`** (`018_outbox_paper_enqueue_dedup.sql`), **policy configurations** (`019_policy_configurations.sql`), **policy configuration scopes** (`020_policy_configuration_scopes.sql`, CFG-3), **paper capital reservations** (`021_paper_capital_reservations.sql`), **paper discovery candidates** (`022_paper_discovery_candidates.sql`, `023_paper_discovery_candidates_fixes.sql`), later **`024`–`028`** (execution playbooks, watchlist/scoring history, paper drift `route_key`), **`029_intake_policy_seed.sql`** (defaults for `intake.throttling` / `intake.routing.tiers`), **`030_paper_promotion_quality_fields.sql`**, **`031_portfolio_position_close_idempotency.sql`**, **`032_dex_filters_seed.sql`** (DEX opportunity filters seed), **`033_dex_on_chain.sql`** (`on_chain_transactions`, `wallet_states`, `dex_pools`, `approvals` + indexes + triggers).
- Canonical registry tables are not auto-seeded; after migrations, `venue_refs`, `canonical_instruments`, and `canonical_routes` must be populated manually before `resolve-*` endpoints return data.

### Phase 2 slice (controlled execution / policy)

- **HTTP venue:** `VENUE_HTTP_BASE_URL` + optional `VENUE_HTTP_TIMEOUT_MS`; lab stand [`tools/lab-venue-stand.mjs`](tools/lab-venue-stand.mjs) (`LAB_VENUE_PORT`); CI Phase 2 chain: `npm run ci:e2e-phase2` / job **`e2e-phase2`**.
- **Risk profiles:** `GET /policy/phase2-readiness`, `GET /policy/token-profiles`, `GET /policy/route-profiles`; `POST /evaluate-risk` optional `instrumentKey` / `routeKey` (DB caps). Roadmap: [`docs/phase2-risk-policy-roadmap.md`](docs/phase2-risk-policy-roadmap.md).
- **Reconciliation P0 procedure** (operator checklist): [`docs/reconciliation-p0-procedures.md`](docs/reconciliation-p0-procedures.md).
- **Metrics:** shared registry via `getArbibotMetricsRegistry()` from `@arbibot/nest-platform` (same registry as `GET /metrics`); orchestrator exposes `arb_execution_leg_partial_fill_commits_total` on partial fills.
- **Observability v1:** SLO v1 and on-call in [`docs/observability-tracing.md`](docs/observability-tracing.md) — production-ready baseline with 3 tiers (Tier 1: 500ms p99, 99.9% monthly).

### Phase 3 slice (paper) — complete implementation (2026-04-18)

- **`@arbibot/paper-trading-service`** (default port **3018**): single-writer HTTP API for paper trades, promotion candidates, drift samples, and discovery candidates; persistence in Postgres via migrations **`016_paper_trading.sql`**, **`017_paper_promotion_enqueue_idempotency.sql`**, **`018_outbox_paper_enqueue_dedup.sql`**, **`021_paper_capital_reservations.sql`**, **`022_paper_discovery_candidates.sql`**, **`023_paper_discovery_candidates_fixes.sql`** (apply with `npm run db:migrate`).
- **Opportunity → paper:** `POST /opportunities/:id/paper-enqueue` writes **`PaperPromotionCandidateRequested`** to **`outbox_events`**; pending-row dedup for enqueue is enforced by **`018_outbox_paper_enqueue_dedup.sql`** on the same OLTP DB as the outbox. The opportunity relay delivers to paper (idempotent **`enqueueIdempotencyKey`** on the paper side). Env: **`PAPER_TRADING_SERVICE_URL`** (service-to-service), **`PAPER_API_BASE`** / BFF for operator reads.

#### P3-1, P3-2: Paper Trades & Promotion Candidates Mutations
- **Backend:** `POST /paper/trades/:id/approve|reject|cancel`, `POST /paper/promotion-candidates/:id/approve|reject`
- **Service:** `PaperTradesService`, `PaperPromotionService` with audit integration
- **BFF:** `/api/operator/paper/trades/[id]?action=approve|reject|cancel`, `/api/operator/paper/promotion-candidates/[id]?action=approve|reject`
- **Frontend:** approval buttons in `PaperTradesTable`, `PaperPromotionTable`

#### P3-3: Virtual Capital (Paper-Only)
- **Migration:** `021_paper_capital_reservations.sql` — table with state machine (active → expired)
- **Entity:** `PaperCapitalReservationEntity` in @arbibot/persistence
- **Service:** `PaperCapitalService` with reserveCapital/expireReservations/getActiveReservation
- **Integration:** PaperTradesService.approve creates reservation, PaperTradesService.cancel expires reservations
- **TTL:** 60 minutes default, background job for expiry
- **Isolation:** complete separation from live capital-service

#### P3-4: Paper Discovery Pipeline
- **Service:** `PaperDiscoveryService` — worker for automatic paper-only opportunities
- **Controller:** `PaperDiscoveryController` — endpoints for triggering discovery, listing candidates
- **Worker:** `PaperDiscoveryWorker` — periodic discovery cycles (configurable via env vars)
- **Entity:** `PaperDiscoveryCandidateEntity` in @arbibot/persistence
- **Migrations:** `022_paper_discovery_candidates.sql`, `023_paper_discovery_candidates_fixes.sql`
- **State machine:** discovered → processed | rejected (enqueued removed per paper isolation)
- **E2E:** `tools/e2e-p3-paper-discovery.mjs` — complete discovery workflow test
- **Policy (config-service):** effective JSON on key **`paper.discovery`** (`GET /policy/configurations/paper.discovery/effective`); cache `PAPER_DISCOVERY_CONFIG_CACHE_MS`; fallback env lists — [`docs/paper-discovery-config-keys.md`](docs/paper-discovery-config-keys.md)
- **Tests:** `paper-discovery.service.spec.ts` — expanded with mock fetch and env-specific module build
- **Review gate:** checklist for CFG-3 UI and paper discovery integration — [`docs/review-gate-cfg3-paper-discovery.md`](docs/review-gate-cfg3-paper-discovery.md)
- **Status:** `PRIO-P2-PAPERDISC` → **`done`** (see [`docs/review-gate-cfg3-paper-discovery.md`](docs/review-gate-cfg3-paper-discovery.md))
- **Env vars:** `CONFIG_SERVICE_URL` or `CONFIG_API_BASE`, `PAPER_DISCOVERY_CONFIG_CACHE_MS`, `PAPER_DISCOVERY_CONFIG_ENVIRONMENT`, `PAPER_DISCOVERY_CONFIG_TENANT_ID`, plus `PAPER_DISCOVERY_ENABLED`, `PAPER_DISCOVERY_INTERVAL_MS`, `PAPER_DISCOVERY_MIN_PROFIT_USD`, `PAPER_DISCOVERY_MIN_LIQUIDITY_SCORE`, `PAPER_DISCOVERY_MAX_CANDIDATES_PER_RUN`, `PAPER_DISCOVERY_PAPER_ONLY_TOKENS`, `PAPER_DISCOVERY_PAPER_ONLY_ROUTES`

#### P3-5: Drift Gauges & Recording Rules
- **Service:** `updateStaleGauges()` method in `PaperDriftService`
- **Gauges:** `paperDriftBpsCurrent` (current drift), `paperDriftBpsStale` (stale instruments count)
- **Recording rules:** `infra/grafana/recording-rules/paper-drift-recording.yml`
  - `arb_paper_drift_bps_avg_5m` — average drift over 5m
  - `arb_paper_drift_bps_max_15m` — maximum drift over 15m
  - `arb_paper_drift_samples_p95_rate_1h` — P95 rate over 1h
  - `arb_paper_drift_samples_rate_1m` — rate per minute
- **Alerts:** v1 (PaperDriftBpsHigh > 50 bps), v2 (PaperDriftBpsSustainedHigh > 30 bps for 15m)

#### P3-6: E2E Test & CI
- **E2E script:** `tools/e2e-phase3-paper-promotion.mjs` — extended with promotion approval, virtual capital reservation, paper trade cancel
- **CI job:** `e2e-phase3-paper-promotion` in GitHub Actions
- **Script wrapper:** `tools/ci-e2e-phase3-paper-promotion.sh`
- **Paper discovery E2E:** `tools/e2e-p3-paper-discovery.mjs`; CI job **`e2e-phase3-paper-discovery`**, wrapper `npm run ci:e2e-phase3-paper-discovery` (`tools/ci-e2e-phase3-paper-discovery.sh`)

- **Operator UI:** **`/paper`** and **`/tokens`** include paper trades, promotion candidates, drift samples, and discovery candidates with proper mutation flows
- **Paper quality:** Grafana dashboards (`arbibot-paper-trading.json`), drift alerts v1/v2, promotion candidate tracking, drift samples collection

### Config service (CFG-1, CFG-2, CFG-3 slice) — 2026-04-18

- **`@arbibot/config-service`** (default port **3019**): single-writer HTTP API for managed policy configuration with Redis cache and audit integration; persistence in Postgres via migrations **`019_policy_configurations.sql`** and **`020_policy_configuration_scopes.sql`** (apply with `npm run db:migrate`).
- **API endpoints (prefix `/policy`):**
  - `GET /configurations` — list (optional scope query); Redis-backed cache (~60s TTL) with DB fallback
  - `GET /configurations/:configKey` — single key (optional scope)
  - `GET /configurations/:configKey/effective` — resolved value with scope fallback (global → environment → tenant)
  - `GET /configurations/:configKey/history` — version history per scope
  - `POST /configurations`, `PUT /configurations/:configKey` — create/update (new row per change); body **`operatorId`** required (400 if missing); optional **`status`** `draft` \| `active` (default `active`)
  - `POST /configurations/:configKey/rollback` — rollback to a prior version (CFG-3)
  - `POST /configurations/:configKey/promote` — promote active row from one scope to another (CFG-3); optional **`idempotencyKey`**
  - `PATCH /configurations/:configKey/status` — activate latest draft in scope (`status: active`)
- **Sensitive keys:** pattern `risk.*`, `execution.*`, `capital.*` require **`approveReason`** on mutations.
- **Audit:** Mutations call **`AuditClientService.appendEntry`**.
- **BFF / UI:** **`CONFIG_API_BASE`** for **`/settings`**; optional **`ARBIBOT_DEV_OPERATOR_ID`** in env for stable audit actor in dev.
- **Docs:**
- Staged rollout nuances — [`docs/cfg-3-staged-rollout.md`](docs/cfg-3-staged-rollout.md)
- Service map — [`docs/services.md`](docs/services.md)
- Paper discovery config keys — [`docs/paper-discovery-config-keys.md`](docs/paper-discovery-config-keys.md)
- Review gate checklist — [`docs/review-gate-cfg3-paper-discovery.md`](docs/review-gate-cfg3-paper-discovery.md)
- Session summary — [`docs/session_summary.md`](docs/session_summary.md)
- **E2E:** Cache/audit verified manually; automated config E2E not required in root CI today.

### CI

[`.github/workflows/ci.yml`](.github/workflows/ci.yml) runs on Node **22**:

1. **build** — `npm ci`, then Turbo `lint`, `build`, `test` for the whole monorepo.
2. **`e2e-phase2`** — after `npm ci` + `npm run build`, runs `npm run ci:e2e-phase2` (Postgres service container + lab HTTP venue + built Nest apps — controlled execution chain).
3. **`e2e-phase2-watchlist-route-scoring`** — after `npm ci` + `npm run build`, runs `npm run ci:e2e-phase2-watchlist-route-scoring` (Postgres + **risk-service** — policy writer smoke).
4. **`e2e-phase3-paper-promotion`** — after `npm ci` + `npm run build`, runs `npm run ci:e2e-phase3` / `bash tools/ci-e2e-phase3-paper-promotion.sh` (Postgres + **paper-trading-service** + **opportunity-service**, paper promotion relay smoke).
5. **`e2e-phase3-paper-discovery`** — after `npm ci` + `npm run build`, runs `npm run ci:e2e-phase3-paper-discovery` / `bash tools/ci-e2e-phase3-paper-discovery.sh` (Postgres + **paper-trading-service** + **market-intake-service**, then `node tools/e2e-p3-paper-discovery.mjs`).
6. **`e2e-phase4-tier-routing`** — after `npm ci` + `npm run build`, runs `npm run ci:e2e-phase4-tier-routing` (Postgres + **risk-service** + **config-service** + **market-intake** + `tools/e2e-phase4-tier-routing.mjs`).
7. **`bus-smoke`** — after `npm ci`, runs `npm run ci:bus-smoke` (bridge build + optional Docker `--profile bus`; no full monorepo `npm run build` in this job).

**Review gate (documentation, not a CI job):** [`docs/review-gate-cfg3-paper-discovery.md`](docs/review-gate-cfg3-paper-discovery.md) — required items completed 2026-04-19; optional full bus E2E deferred.

### Frontend Documentation

- **`apps/web/FRONTEND_FIXES_SUMMARY.md`** — comprehensive summary of frontend architecture fixes (destructive operator actions, type consolidation, Tailwind migration, query invalidation strategy)
- **`apps/web/QUERY_INVALIDATION.md`** — complete React Query invalidation strategy for all dashboard queries (dashboard, incidents, opportunities, execution, portfolio, paper, settings)
- **`components/README-APPROVAL-FLOW.md`** — documentation for `DestructiveOperatorAction` component with usage examples and compliance checklist
- **`apps/web/components/settings-workspace.tsx`** — CFG-3 UI with promote/activate draft, draft checkboxes, Promote modal, DestructiveOperatorAction integration, React Query invalidation
- **`apps/web/components/degraded-status-banner.tsx`** — Phase 4 degraded signals banner (polling 30s, dismissible, operator layout integration)
- **`docs/review-gate-cfg3-paper-discovery.md`** — review gate checklist for CFG-3 UI and paper discovery integration (backend/frontend/architecture, metrics, bus-smoke optional)
- **`docs/phase4-prep-bridge.md`** — Phase 4 prep plan: CI, observability, offline export for watchlist/route analytics
- **`docs/route-scoring-replay.md`** — P4-4-SCORE: offline/staging replay for `route_scoring_history` (single-writer risk-service)
- **`docs/adr-phase4-clickhouse-gate.md`** — P4-4-CH: when to introduce ClickHouse / DWH for route-scoring analytics (no second writer)
- **`docs/adr-phase4-intake-throttling.md`** — ADR for Phase 4 intake throttling architecture (policy cache, fallback, single-writer)
- **`docs/phase4-ui-degraded-signals.md`** — Phase 4 degraded UI signals design (market-intake health, operator dashboard, banner)
- **`docs/intake-policy-config-keys.md`** — config JSON keys `intake.throttling` / `intake.routing.tiers` (Phase 4)
- **`docs/paper-promotion-quality-criteria.md`** — Paper promotion quality criteria (P2 prep)
- **`docs/openclaw-operator-api-spec.md`** — OpenClaw operator API specification (Phase 5 gateway)
