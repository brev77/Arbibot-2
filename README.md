# Arbibot 2

Монорепозиторий высокопроизводительной системы крипто-арбитража: canonical market → intake рынка → возможности → риск → капитал → оркестрация исполнения → портфель и сверка. Сейчас в фокусе **Phase 0–1** (и задел Phase 2): сервисы `canonical-market` и `market-intake`, вертикальный срез snapshot → opportunity → risk → reserve → **arm** (`npm run e2e:phase1-foundation`), общая схема БД, операторский dashboard (Next.js), сервисы **portfolio** и **reconciliation**, in-DB outbox/inbox для `RiskDecisionIssued` → `opportunity-service` и dev Kafka/Redpanda bridge для `SnapshotUpdated`, `CapitalReserved`, `PlanArmed`, `LegFilled`, `PlanCompleted`.

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
| `apps/risk-service` | Оценка риска, `POST /evaluate-risk`, `POST /reserve-risk-window`, outbox `RiskDecisionIssued`, идемпотентность |
| `apps/opportunity-service` | Возможности: lifecycle `detected → enriched → risk_checked`, HTTP к risk, **outbox relay** (поллинг → inbox → домен); см. `OUTBOX_RELAY_*` в env |
| `apps/capital-service` | Резервы капитала, TTL, transactional outbox `CapitalReserved` |
| `apps/execution-orchestrator` | Планы исполнения `planned → reserved → armed → …`, ноги исполнения, transactional outbox (`PlanArmed` и др.); опционально пост-commit settlement → portfolio/capital (см. `docs/settlement-post-commit.md`) |
| `apps/portfolio-service` | Позиции портфеля, идемпотентный подтверждённый fill |
| `apps/reconciliation-service` | Несоответствия сверки, детекторы / статусы |
| `apps/audit-service` | Append/list аудита, идемпотентный append |
| `apps/canonical-market-service` | Канонический реестр площадок / инструментов / маршрутов: `POST /market/resolve-instrument`, `POST /market/resolve-route` |
| `apps/market-intake-service` | Ingest snapshots: `POST /snapshots/ingest`, `GET /snapshots`, freshness, outbox `SnapshotUpdated` |
| `apps/web` | Operator UI (Next.js App Router), маршруты оператора под `app/(operator)/`, **RBAC в `middleware.ts`** (cookie `arbibot_role` / `ARBIBOT_DEV_ROLE`); конвенции: [`apps/web/STACK-CONVENTIONS.md`](apps/web/STACK-CONVENTIONS.md) |
| `packages/persistence` | Сущности TypeORM, outbox/inbox, TTL-хелперы |
| `packages/contracts` | HTTP-константы маршрутов, имена событий, типы payload и event envelopes |
| `packages/messaging` | `tryClaimInboxMessage`, `fetchLockedOutboxBatch(..., eventTypes)` |
| `packages/outbox-kafka-bridge` | Публикация `SnapshotUpdated`, `CapitalReserved`, `PlanArmed`, `LegFilled`, `PlanCompleted` в Kafka/Redpanda и smoke-consumer с inbox claim |
| `packages/nest-database` / `nest-platform` | БД, Redis helper, correlation id, логи, **Prometheus `/metrics`**, audit HTTP client |
| `infra/postgres/migrations` | SQL-миграции `001` … `013` (ядро, риск, canonical/intake, execution legs, portfolio, reconciliation, fill/idempotency — см. каталог) |
| `docs/` | Спеки и runbooks: [`docs/outbox-inbox.md`](docs/outbox-inbox.md), [`docs/settlement-post-commit.md`](docs/settlement-post-commit.md), [`docs/observability-tracing.md`](docs/observability-tracing.md), [`docs/openclaw-reference.md`](docs/openclaw-reference.md), [`docs/TODO.md`](docs/TODO.md) |
| `.cursor/plans/DEVELOPMENT_PLAN.md` | Пошаговый план разработки и статусы |
| [`AGENTS.md`](AGENTS.md) | Кратко для агентов/разработчиков: workspaces, graphify, e2e, CI |

### HTTP API (выдержка)

Помимо `GET/POST /opportunities`: `POST /opportunities/:id/enrich`, `POST /opportunities/:id/request-risk-evaluation`. Зеркало в `packages/contracts` (`OPPORTUNITY_HTTP_ROUTES`) и [`docs/openapi-draft.yaml`](docs/openapi-draft.yaml).

`canonical-market-service`: `POST /market/resolve-instrument`, `POST /market/resolve-route`.

`market-intake-service`: `POST /snapshots/ingest`, `GET /snapshots`.

## Скрипты в корне

| Команда | Описание |
|---------|----------|
| `npm run build` | Сборка всех пакетов через Turbo |
| `npm run test` | Тесты во всех workspace |
| `npm run lint` | ESLint по workspace (входит в CI) |
| `npm run db:migrate` | Применить SQL-миграции (`DATABASE_URL` обязателен) |
| `npm run e2e:phase1-foundation` | HTTP-smoke цепочки Phase 1 (нужны миграции и запущенные intake, opportunity, risk, capital, execution); опционально `E2E_INCLUDE_EXECUTION_LEG=true` — шаги до `apply-fill` |
| `npm run dev:risk` | Risk service в watch-режиме |
| `npm run dev:opportunity` | Opportunity service |
| `npm run dev:capital` | Capital service |
| `npm run dev:execution` | Execution orchestrator |
| `npm run dev:audit` | Audit service |
| `npm run dev:canonical` | Canonical market service |
| `npm run dev:intake` | Market intake service |
| `npm run dev:portfolio` | Portfolio service |
| `npm run dev:reconciliation` | Reconciliation service |
| `npm run dev:web` | Next.js dev server |
| `npm run bus:publish` | Собрать и запустить publisher outbox → Kafka/Redpanda (`SnapshotUpdated`, `CapitalReserved`, `PlanArmed`, `LegFilled`, `PlanCompleted`) |
| `npm run bus:consume` | Собрать и запустить smoke-consumer с inbox claim |

Перед запуском сервисов задайте **`DATABASE_URL`** (и при необходимости `PORT`). Для opportunity → risk: **`RISK_SERVICE_URL`**. Для bus-скриптов: **`KAFKA_BROKERS=127.0.0.1:19092`**. Релей outbox в `opportunity-service`: по умолчанию включён; отключение: `OUTBOX_RELAY_ENABLED=false`.

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
| Web (Next dev) | 3000* |
| Redpanda / Kafka API (dev, `bus` profile) | 19092 |

\*При одновременном запуске web и risk на одной машине задайте разные порты, например `PORT=3001` для одного из процессов или `next dev -p 3005` для web.

Для server-side fetch в `apps/web` используйте сервисные URL из [`.env.example`](.env.example), например:

- `OPPORTUNITY_SERVICE_URL`
- `EXECUTION_ORCHESTRATOR_URL`
- `AUDIT_SERVICE_URL`
- `PORTFOLIO_API_BASE`, `RECONCILIATION_API_BASE` (серверный fetch в `apps/web`; см. [`.env.example`](.env.example))

## Локальный bus smoke

После `docker compose -f infra/docker-compose.dev.yml --profile bus up -d`:

```bash
set DATABASE_URL=postgres://arbibot:arbibot@127.0.0.1:5432/arbibot
set KAFKA_BROKERS=127.0.0.1:19092
npm run bus:consume
```

В другом терминале:

```bash
set DATABASE_URL=postgres://arbibot:arbibot@127.0.0.1:5432/arbibot
set KAFKA_BROKERS=127.0.0.1:19092
npm run bus:publish
```

Bridge публикует `SnapshotUpdated`, `CapitalReserved`, `PlanArmed`, `LegFilled`, `PlanCompleted` (общий топик; выбор строки по `event_type` и `ORDER BY id`). In-DB relay для `RiskDecisionIssued` в `opportunity-service` остается отдельным потоком и не конкурирует за `processed_at` с этими типами.

## Seed note

После `npm run db:migrate` канонический справочник (`venue_refs`, `canonical_instruments`, `canonical_routes`) нужно загрузить вручную, иначе `resolve-instrument` / `resolve-route` будут возвращать `404`. Отдельного seed-скрипта в репозитории сейчас нет.

### Роли в UI (dev)

Cookie **`arbibot_role`**: `viewer` | `operator` | `admin`. В production без cookie и без `ARBIBOT_DEV_ROLE` доступ к защищённым маршрутам закрыт (редирект на `/`). В dev без настроек действует роль `operator` по умолчанию.

## CI

На push/PR в `main` / `master` GitHub Actions выполняет `npm ci` на **Node 22**, затем **`npm run lint`**, `npm run build`, `npm run test` (см. [`.github/workflows/ci.yml`](.github/workflows/ci.yml)).

## Архитектура и правила

Инварианты (single-writer, reservation-first, outbox/inbox и др.) зафиксированы в Cursor rules и в документах в `docs/`. Перед крупными изменениями сверяйтесь с [`.cursor/plans/DEVELOPMENT_PLAN.md`](.cursor/plans/DEVELOPMENT_PLAN.md). Для локального knowledge graph см. раздел graphify в [`AGENTS.md`](AGENTS.md).
