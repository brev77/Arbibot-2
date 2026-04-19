# Arbibot 2

Монорепозиторий высокопроизводительной системы крипто-арбитража: canonical market → intake рынка → возможности → риск → капитал → оркестрация исполнения → портфель и сверка. Закрыты **Phase 0–2** (controlled execution), реализован базовый срез **Phase 3** (paper trading): snapshot → opportunity → risk → reserve → **arm**, полный контур ног до `plan.completed` (`npm run e2e:phase2-controlled-execution`, в CI — `npm run ci:e2e-phase2`), **portfolio** / **reconciliation** / UI `/incidents`, HTTP lab-venue, in-DB relay для `RiskDecisionIssued` и `PaperPromotionCandidateRequested`, Kafka bridge для `SnapshotUpdated`, `CapitalReserved`, `PlanArmed`, `LegFilled`, `PlanCompleted`. Профили риска (**token_profiles** / **route_profiles**, миграция `015`) и read API в **risk-service** под `/policy/*` — [`docs/phase2-risk-policy-roadmap.md`](docs/phase2-risk-policy-roadmap.md); **policy configurations** (таблицы `policy_configurations`, миграции `019`–`020`) и Config API в **config-service** (`/policy/configurations`), operator UI **`/settings`** — дорожная карта staged rollout: [`docs/cfg-3-staged-rollout.md`](docs/cfg-3-staged-rollout.md).

**Первичный запуск (канон):** перед выставлением реальных средств система **сначала** выводится в режим **paper trading** — сквозной операционный тест всей связки и сбор статистики; затем **live с минимальным капиталом**. Подробнее: [.cursor/plans/DEVELOPMENT_PLAN.md](.cursor/plans/DEVELOPMENT_PLAN.md) («Операционная последовательность первичного запуска»), `!Arbibot_2_Architecture_v1_final_docs_settings.md` (разделы 13 и 50.5).

## Требования

- **Node.js** ≥ 22 ([`package.json`](package.json))
- **npm** 11+ (см. `packageManager` в корне)
- **PostgreSQL** для Nest-приложений с TypeORM (одна БД на dev)
- **Redis** 7 (локально из Compose; используется сервисами по мере внедрения, см. `.env.example`)
- **Docker Compose** для локального Postgres / Redis и опционально Redpanda (`--profile bus`)

## Быстрый старт

```bash
git clone <url> arbibot-2
cd arbibot-2
npm ci
```

1. Скопируйте переменные окружения и подставьте рабочий `DATABASE_URL`:

   ```bash
   cp .env.example .env
   ```

2. Поднимите PostgreSQL и Redis:

   ```bash
   docker compose -f infra/docker-compose.dev.yml up -d
   ```

   Если хотите проверить Kafka/Redpanda bridge для outbox-событий (`SnapshotUpdated`, `CapitalReserved`, `PlanArmed`, `LegFilled`, `PlanCompleted`), поднимите также профиль `bus`:

   ```bash
   docker compose -f infra/docker-compose.dev.yml --profile bus up -d
   ```

3. Примените миграции:

   ```bash
   npm run db:migrate
   ```

   Учёт применённых файлов ведётся в таблице `schema_migrations`. Если ядро (`001_core.sql`) накатывали вручную до появления учёта, один раз выполните [`infra/postgres/bootstrap-schema-migrations.sql`](infra/postgres/bootstrap-schema-migrations.sql), затем снова `npm run db:migrate`. Подробнее: [`infra/postgres/README.md`](infra/postgres/README.md).

4. Сборка, линт и тесты (как в CI):

   ```bash
   npm run lint
   npm run build
   npm run test
   ```

## Структура репозитория

| Путь | Назначение |
|------|------------|
| `apps/risk-service` | Оценка риска, `POST /evaluate-risk` (опционально `instrumentKey` / `routeKey` и caps из БД), `POST /reserve-risk-window`, `GET /policy/*`, outbox `RiskDecisionIssued`, идемпотентность |
| `apps/opportunity-service` | Возможности: lifecycle `detected → enriched → risk_checked`, HTTP к risk, **outbox relay** (поллинг → inbox → домен); `POST /opportunities/:id/paper-enqueue` → paper queue; см. `OUTBOX_RELAY_*` в env |
| `apps/capital-service` | Резервы капитала, TTL, transactional outbox `CapitalReserved` |
| `apps/execution-orchestrator` | Планы исполнения `planned → reserved → armed → …`, ноги исполнения, transactional outbox (`PlanArmed`, `LegFilled`, `PlanCompleted`); опционально `VENUE_HTTP_BASE_URL` / lab venue; метрика `arb_execution_leg_partial_fill_commits_total` при partial fill; пост-commit settlement → portfolio/capital (см. `docs/settlement-post-commit.md`) |
| `apps/portfolio-service` | Позиции портфеля, идемпотентный подтверждённый fill |
| `apps/reconciliation-service` | Несоответствия сверки, детекторы / статусы; Jest-тесты в `src/**/*.spec.ts` |
| `apps/audit-service` | Append/list аудита, идемпотентный append |
| `apps/config-service` | Policy configurations: `GET/POST/PUT /policy/configurations`, Redis-кэш, audit для мутаций; порт по умолчанию **3019** |
| `apps/canonical-market-service` | Канонический реестр площадок / инструментов / маршрутов: `POST /market/resolve-instrument`, `POST /market/resolve-route` |
| `apps/market-intake-service` | Ingest snapshots: `POST /snapshots/ingest`, `GET /snapshots`, freshness, outbox `SnapshotUpdated` |
| `apps/paper-trading-service` | Paper trading engine: paper trades, promotion candidates, drift samples; single-writer HTTP API; миграции `016`, `017`, `018` |
| `apps/web` | Operator UI (Next.js App Router), маршруты оператора под `app/(operator)/`, **RBAC в `middleware.ts`** (cookie `arbibot_role` / `ARBIBOT_DEV_ROLE`); UI `/paper`, `/tokens`, **`/settings`** (policy config); конвенции: [`apps/web/STACK-CONVENTIONS.md`](apps/web/STACK-CONVENTIONS.md) |
| `packages/persistence` | Сущности TypeORM, outbox/inbox, TTL-хелперы, paper и policy configuration |
| `packages/contracts` | HTTP-константы маршрутов, имена событий, типы payload и event envelopes, paper schemas |
| `packages/messaging` | `tryClaimInboxMessage`, `fetchLockedOutboxBatch(..., eventTypes)` |
| `packages/outbox-kafka-bridge` | Публикация `SnapshotUpdated`, `CapitalReserved`, `PlanArmed`, `LegFilled`, `PlanCompleted` в Kafka/Redpanda и smoke-consumer с inbox claim |
| `packages/nest-database` / `nest-platform` | БД, Redis helper, correlation id, логи, **Prometheus `/metrics`**, `getArbibotMetricsRegistry()`, audit HTTP client |
| `infra/postgres/migrations` | SQL-миграции `001` … `020` (ядро, риск, canonical/intake, execution legs, portfolio, reconciliation, fill/idempotency, token/route profiles, paper + outbox dedup, **policy configurations** — см. каталог) |
| `docs/` | Спеки и runbooks: [`docs/outbox-inbox.md`](docs/outbox-inbox.md), [`docs/settlement-post-commit.md`](docs/settlement-post-commit.md), [`docs/observability-tracing.md`](docs/observability-tracing.md), [`docs/reconciliation-p0-procedures.md`](docs/reconciliation-p0-procedures.md), [`docs/phase2-risk-policy-roadmap.md`](docs/phase2-risk-policy-roadmap.md), [`docs/cfg-3-staged-rollout.md`](docs/cfg-3-staged-rollout.md), [`docs/openclaw-reference.md`](docs/openclaw-reference.md), [`docs/TODO.md`](docs/TODO.md) |
| `.cursor/plans/DEVELOPMENT_PLAN.md` | Пошаговый план разработки и статусы |
| [`AGENTS.md`](AGENTS.md) | Кратко для агентов/разработчиков: workspaces, graphify, e2e, CI |

### HTTP API (выдержка)

Помимо `GET/POST /opportunities`: `POST /opportunities/:id/enrich`, `POST /opportunities/:id/request-risk-evaluation`. Зеркало в `packages/contracts` (`OPPORTUNITY_HTTP_ROUTES`) и [`docs/openapi-draft.yaml`](docs/openapi-draft.yaml).

`canonical-market-service`: `POST /market/resolve-instrument`, `POST /market/resolve-route`.

`market-intake-service`: `POST /snapshots/ingest`, `GET /snapshots`.

`config-service`: `GET /policy/configurations`, `GET /policy/configurations/:key`, мутации с audit (см. OpenAPI-черновик и `apps/config-service`).

## Скрипты в корне

| Команда | Описание |
|---------|----------|
| `npm run build` | Сборка всех пакетов через Turbo |
| `npm run test` | Тесты во всех workspace |
| `npm run lint` | ESLint по workspace (входит в CI) |
| `npm run db:migrate` | Применить SQL-миграции (`DATABASE_URL` обязателен) |
| `npm run e2e:phase1-foundation` | HTTP-smoke цепочки Phase 1 (нужны миграции и запущенные intake, opportunity, risk, capital, execution); опционально `E2E_INCLUDE_EXECUTION_LEG=true` — шаги до `apply-fill` |
| `npm run e2e:phase2-controlled-execution` | Полный контур ног до `plan.completed` (см. `tools/e2e-phase2-controlled-execution.mjs`; `EXECUTION_BEGIN_LEG_COUNT`, venue mock или HTTP) |
| `npm run e2e:phase3-paper-promotion` | Smoke: create opportunity → `paper-enqueue` (dedup) → poll paper `/promotion-candidates` until relay delivers (см. `tools/e2e-phase3-paper-promotion.mjs`) |
| `npm run ci:e2e-phase2` | Тот же сценарий в окружении CI: Postgres + lab HTTP venue + собранные Nest-приложения (`tools/ci-e2e-phase2.sh`) |
| `npm run ci:e2e-phase3` | CI: Postgres + `paper-trading-service` + `opportunity-service` (`PAPER_TRADING_SERVICE_URL`, быстрый `OUTBOX_RELAY_POLL_MS`) + `e2e:phase3-paper-promotion` (`tools/ci-e2e-phase3-paper-promotion.sh`) |

**Критерии зелёного `e2e:phase3-paper-promotion`:** оба сервиса отвечают на `GET /metrics`; `POST /opportunities` создаёт запись; первый `POST .../paper-enqueue` не помечен `deduplicated`, второй с тем же ключом — `deduplicated: true`; в течение ~20 с после enqueue в ответе `GET {PAPER_URL}/paper/promotion-candidates` появляется элемент с тем же `opportunityId`. Локально: миграции (включая `018`), `PAPER_TRADING_SERVICE_URL` у opportunity указывает на paper.

| Команда | Описание |
|---------|----------|
| `npm run dev:risk` | Risk service в watch-режиме |
| `npm run dev:opportunity` | Opportunity service |
| `npm run dev:capital` | Capital service |
| `npm run dev:execution` | Execution orchestrator |
| `npm run dev:audit` | Audit service |
| `npm run dev:canonical` | Canonical market service |
| `npm run dev:intake` | Market intake service |
| `npm run dev:portfolio` | Portfolio service |
| `npm run dev:reconciliation` | Reconciliation service |
| `npm run dev:paper` | Paper trading service |
| `npm run dev:config` | Config service (policy configurations) |
| `npm run dev:web` | Next.js dev server |
| `npm run bus:publish` | Собрать и запустить publisher outbox → Kafka/Redpanda (`SnapshotUpdated`, `CapitalReserved`, `PlanArmed`, `LegFilled`, `PlanCompleted`) |
| `npm run bus:consume` | Собрать и запустить smoke-consumer с inbox claim |

Перед запуском сервисов задайте **`DATABASE_URL`** (и при необходимости `PORT`). Для **config-service** также **`REDIS_URL`** (кэш policy). Для opportunity → risk: **`RISK_SERVICE_URL`**. Для bus-скриптов: **`KAFKA_BROKERS=127.0.0.1:19092`**. Релей outbox в `opportunity-service`: по умолчанию включён; отключение: `OUTBOX_RELAY_ENABLED=false`.

## Порты по умолчанию

| Сервис | Порт (env `PORT`) |
|--------|-------------------|
| Risk | 3000 |
| Opportunity | 3010 |
| Capital | 3011 |
| Execution orchestrator | 3012 |
| Audit | 3013 |
| Canonical market | 3014 |
| Market intake | 3015 |
| Portfolio | 3016 |
| Reconciliation | 3017 |
| Paper trading | 3018 |
| Config | 3019 |
| Web (Next dev) | 3000* |
| Redpanda / Kafka API (dev, `bus` profile) | 19092 |

\*При одновременном запуске web и risk на одной машине задайте разные порты, например `PORT=3001` для одного из процессов или `next dev -p 3005` для web.

Для server-side fetch в `apps/web` используйте сервисные URL из [`.env.example`](.env.example), например:

- `OPPORTUNITY_SERVICE_URL`
- `EXECUTION_ORCHESTRATOR_URL`
- `AUDIT_SERVICE_URL`
- `CONFIG_API_BASE` (policy configurations в `/settings`)
- `PORTFOLIO_API_BASE`, `RECONCILIATION_API_BASE`, `PAPER_API_BASE` (серверный fetch в `apps/web`; см. [`.env.example`](.env.example))

## Локальный bus smoke

После `docker compose -f infra/docker-compose.dev.yml --profile bus up -d`:

```bash
set DATABASE_URL=postgres://arbibot:arbibot@127.0.0.1:15432/arbibot
set KAFKA_BROKERS=127.0.0.1:19092
npm run bus:consume
```

В другом терминале:

```bash
set DATABASE_URL=postgres://arbibot:arbibot@127.0.0.1:15432/arbibot
set KAFKA_BROKERS=127.0.0.1:19092
npm run bus:publish
```

Bridge публикует `SnapshotUpdated`, `CapitalReserved`, `PlanArmed`, `LegFilled`, `PlanCompleted` (общий топик; выбор строки по `event_type` и `ORDER BY id`). In-DB relay для `RiskDecisionIssued` и `PaperPromotionCandidateRequested` в `opportunity-service` остается отдельным потоком и не конкурирует за `processed_at` с этими типами. Smoke-consumer логирует `eventName` и `entityType` при успешном inbox-claim (см. [`docs/outbox-inbox.md`](docs/outbox-inbox.md)).

## Seed note

После `npm run db:migrate` канонический справочник (`venue_refs`, `canonical_instruments`, `canonical_routes`) нужно загрузить вручную, иначе `resolve-instrument` / `resolve-route` будут возвращать `404`. Отдельного seed-скрипта в репозитории сейчас нет.

### Роли в UI (dev)

Cookie **`arbibot_role`**: `viewer` | `operator` | `admin`. В production без cookie и без `ARBIBOT_DEV_ROLE` доступ к защищённым маршрутам закрыт (редирект на `/`). В dev без настроек действует роль `operator` по умолчанию.

## CI

На push/PR в `main` / `master` GitHub Actions выполняет `npm ci` на **Node 22**, затем **`npm run lint`**, `npm run build`, `npm run test` (см. [`.github/workflows/ci.yml`](.github/workflows/ci.yml)).

## Архитектура и правила

Инварианты (single-writer, reservation-first, outbox/inbox и др.) зафиксированы в Cursor rules и в документах в `docs/`. Перед крупными изменениями сверяйтесь с [`.cursor/plans/DEVELOPMENT_PLAN.md`](.cursor/plans/DEVELOPMENT_PLAN.md) (по полю `status` у шагов: на **2026-04** ~**85%** в `done`; оставшийся scope — Phase 4–5, CFG-3, матрица PRIO-P2). Для локального knowledge graph (graphify) см. раздел graphify в [`AGENTS.md`](AGENTS.md): после существенных правок в backend — code-only refresh в корне репозитория (`python` или на Windows **`py -3`** — см. там же).
