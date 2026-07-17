# Arbibot 2

Монорепозиторий высокопроизводительной системы крипто-арбитража: canonical market → intake рынка → возможности → риск → капитал → оркестрация исполнения → портфель и сверка. Закрыты **Phase 0–2** (controlled execution); **Phase 3** (paper): trades / promotion / drift / discovery, виртуальный capital, BFF-мутации, E2E + CI; **Phase 4** (масштаб и политика): tier routing и throttling в **market-intake**, writers watchlist/scoring в **risk-service**, degraded UI, replay route scoring и ADR gate для аналитики/ClickHouse — см. [.cursor/plans/DEVELOPMENT_PLAN.md](.cursor/plans/DEVELOPMENT_PLAN.md); **Phase 5**: **hermes-gateway** и operator UI **`/hermes`**; **D4 deploy-readiness** (Plan 4): operator auth, paging, restore, kill-switch, capital ceiling, wallet keys, bridge finality, mTLS, secret-scan, logging, versioning, panic-stop — см. [`.cursor/plans/DEVELOPMENT_PLAN4.md`](.cursor/plans/DEVELOPMENT_PLAN4.md); **Plan 5**: hermes Agent на GLM 5.2 + Telegram — см. [`.cursor/plans/DEVELOPMENT_PLAN5.md`](.cursor/plans/DEVELOPMENT_PLAN5.md). Технический контур: snapshot → opportunity → risk → reserve → **arm**, полный цикл ног до `plan.completed` (`npm run e2e:phase2-controlled-execution`, в CI — `npm run ci:e2e-phase2`), **portfolio** / **reconciliation** / UI `/incidents`, HTTP lab-venue, in-DB relay для `RiskDecisionIssued` и `PaperPromotionCandidateRequested`, Kafka bridge для `SnapshotUpdated`, `CapitalReserved`, `PlanArmed`, `LegFilled`, `PlanCompleted`. Профили риска и policy jobs — [`docs/phase2-risk-policy-roadmap.md`](docs/phase2-risk-policy-roadmap.md); **config-service** и **`/settings`** — [`docs/cfg-3-staged-rollout.md`](docs/cfg-3-staged-rollout.md).

**Первичный запуск (канон):** перед выставлением реальных средств система **сначала** выводится в режим **paper trading** — сквозной операционный тест всей связки и сбор статистики; затем **live с минимальным капиталом**. Подробнее: [.cursor/plans/DEVELOPMENT_PLAN.md](.cursor/plans/DEVELOPMENT_PLAN.md) («Операционная последовательность первичного запуска»), `!Arbibot_2_Architecture_v1_final_docs_settings.md` (разделы 13 и 50.5).

**Путеводитель по репозиторию:** для разработчиков и операторов — [docs/PROJECT_HANDBOOK.md](docs/PROJECT_HANDBOOK.md) (оглавление, секреты и env, слои настройки системы, мониторинг, ссылки на runbooks и главы `docs/handbook/`).

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
| `apps/paper-trading-service` | Paper trading: trades, promotion, drift, discovery candidates; виртуальный capital (`021`); effective config **`paper.discovery`**; single-writer HTTP API; миграции **`016`–`018`**, **`021`–`023`** |
| `apps/hermes-gateway` | Phase 5: шлюз Operator/hermes API (`/hermes/v1/*`), мутации с audit и rate limit; порт **3020**; см. [`apps/hermes-gateway/README.md`](apps/hermes-gateway/README.md) |
| `apps/web` | Operator UI (Next.js): **`/dashboard`**, **`/paper`**, **`/tokens`**, **`/settings`**, **`/HERMES`**, BFF под `app/api/operator/`; **RBAC** — `middleware.ts` (`arbibot_role` / `ARBIBOT_DEV_ROLE`); конвенции: [`apps/web/STACK-CONVENTIONS.md`](apps/web/STACK-CONVENTIONS.md) |
| `packages/persistence` | Сущности TypeORM, outbox/inbox, TTL-хелперы, paper и policy configuration |
| `packages/contracts` | HTTP-константы маршрутов, имена событий, типы payload и event envelopes, paper schemas |
| `packages/messaging` | `tryClaimInboxMessage`, `fetchLockedOutboxBatch(..., eventTypes)` |
| `packages/outbox-kafka-bridge` | Публикация `SnapshotUpdated`, `CapitalReserved`, `PlanArmed`, `LegFilled`, `PlanCompleted` в Kafka/Redpanda и smoke-consumer с inbox claim |
| `packages/nest-database` / `nest-platform` | БД, Redis helper, correlation id, логи, **Prometheus `/metrics`**, `getArbibotMetricsRegistry()`, audit HTTP client |
| `infra/postgres/migrations` | SQL **`001` … `043`**: ядро, риск, canonical/intake, execution/portfolio/reconciliation, paper + outbox, policy config/scopes, playbooks, watchlist/scoring history, intake seed, paper quality, portfolio close idempotency, DEX on-chain/filters/limits, cross-chain bridge, D4 deploy-readiness (alertmanager, daily-volume, notional, capital limits seed, wallet keys, bridge finality) — см. каталог |
| `docs/` | Runbooks и ADR: [`docs/outbox-inbox.md`](docs/outbox-inbox.md), [`docs/observability-tracing.md`](docs/observability-tracing.md), [`docs/phase2-risk-policy-roadmap.md`](docs/phase2-risk-policy-roadmap.md), [`docs/phase4-prep-bridge.md`](docs/phase4-prep-bridge.md), [`docs/route-scoring-replay.md`](docs/route-scoring-replay.md), [`docs/adr-phase4-clickhouse-gate.md`](docs/adr-phase4-clickhouse-gate.md), [`docs/hermes-gateway-runbook.md`](docs/hermes-gateway-runbook.md), [`docs/ci-verification-checklist.md`](docs/ci-verification-checklist.md), [`docs/TODO.md`](docs/TODO.md) |
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
| `npm run e2e:phase3-paper-promotion` | Smoke: enqueue → relay → кандидат в paper → **approve** кандидата → paper trades (approve / reject / cancel, virtual capital); см. `tools/e2e-phase3-paper-promotion.mjs` |
| `npm run ci:e2e-phase2` | CI: Postgres + lab HTTP venue + собранные Nest apps (`tools/ci-e2e-phase2.sh`); job **`e2e-phase2`** |
| `npm run ci:e2e-phase3` | CI: Postgres + paper + opportunity + `e2e:phase3-paper-promotion` (`tools/ci-e2e-phase3-paper-promotion.sh`); job **`e2e-phase3-paper-promotion`** |
| `npm run ci:e2e-phase3-paper-discovery` | CI: Postgres + paper + market-intake + `e2e-p3-paper-discovery.mjs`; job **`e2e-phase3-paper-discovery`** |
| `npm run e2e:phase2-watchlist-route-scoring` | Сиды + `POST /policy/jobs/*` на risk-service (writers); см. `tools/e2e-phase2-watchlist-route-scoring.mjs` |
| `npm run ci:e2e-phase2-watchlist-route-scoring` | CI-обёртка; job **`e2e-phase2-watchlist-route-scoring`** |
| `npm run e2e:phase4-tier-routing` | Intake tier routing + throttle (нужны risk, config, market-intake); см. `tools/e2e-phase4-tier-routing.mjs` |
| `npm run ci:e2e-phase4-tier-routing` | CI; job **`e2e-phase4-tier-routing`** |
| `npm run ci:bus-smoke` | Сборка bridge + опционально Docker `bus`; job **`bus-smoke`** |
| `npm run export:route-scoring-history` | Экспорт `route_scoring_history` (JSONL/CSV) для replay |
| `npm run replay:route-scoring-export` | Сводка / сравнение JSONL экспортов; см. [`docs/route-scoring-replay.md`](docs/route-scoring-replay.md) |
| `npm run db:verify-migrations` / `db:verify-migrations:all` | Проверка `schema_migrations` (дефолт **030/031** или все `*.sql` через `--all`; актуальный диапазон — `001`–`043`) |

**Критерии зелёного `e2e:phase3-paper-promotion`:** оба сервиса отвечают на `GET /metrics`; dedup `paper-enqueue`; кандидат появляется в paper после relay; затем в скрипте — approve кандидата, цикл paper trades. Локально: миграции через **`018+`**, `PAPER_TRADING_SERVICE_URL` у opportunity → paper.

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
| `npm run dev:hermes` | hermes gateway (порт **3020**) |
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
| HERMES gateway | 3020 (`HERMES_GATEWAY_PORT`) |
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

На push/PR в `main` / `master` — [`.github/workflows/ci.yml`](.github/workflows/ci.yml), **Node 22**. После **`npm ci`**: job **`build`** (`lint`, `build`, `test`); затем параллельно E2E: **`e2e-phase2`**, **`e2e-phase2-watchlist-route-scoring`**, **`e2e-phase3-paper-promotion`**, **`e2e-phase3-paper-discovery`**, **`e2e-phase4-tier-routing`**; **`bus-smoke`** (без полного `build`, по workflow); чеклист — [`docs/ci-verification-checklist.md`](docs/ci-verification-checklist.md).

## License

Distributed under the **MIT License** — see [`LICENSE`](LICENSE).

## Contributing

Contributions are welcome! Before opening a PR:

1. Read [`CONTRIBUTING.md`](CONTRIBUTING.md) — architectural invariants, tech stack rules, PR process.
2. Check that the change is within the current phase scope (Phase 6+ is out of scope — see [`.cursor/plans/DEVELOPMENT_PLAN.md`](.cursor/plans/DEVELOPMENT_PLAN.md)).
3. Run `npm run lint && npm run build && npm run test` locally.
4. Respect the invariants: single-writer, reservation-first, outbox/inbox, idempotency, audit trail for operator actions.

For architecture / scope questions, open a GitHub Discussion.

## Security

**⚠️ Do not open public issues for security vulnerabilities.** See [`SECURITY.md`](SECURITY.md) for the full policy.

- **Private reports:** GitHub → `Security` → `Report a vulnerability` (preferred)
- **Email:** `brev77@users.noreply.github.com` with subject prefix `[SECURITY] Arbibot 2:`
- **Response:** acknowledgment within 72 hours

Before deploying, read the hardening guides in [`docs/security-baseline.md`](docs/security-baseline.md), [`docs/threat-model.md`](docs/threat-model.md), [`docs/vault-integration-guide.md`](docs/vault-integration-guide.md), and [`docs/key-rotation-runbook.md`](docs/key-rotation-runbook.md). Never commit real API keys, RPC endpoints, or private keys — GitHub Secret Scanning and Push Protection reject leaked credentials on push.

## Архитектура и правила

Инварианты (single-writer, reservation-first, outbox/inbox и др.) — в Cursor rules и в `docs/`. Канонический план: [`.cursor/plans/DEVELOPMENT_PLAN.md`](.cursor/plans/DEVELOPMENT_PLAN.md) — у **всех** формальных шагов (`step_id`) поле **`status: done`**; продуктовый и UX-хвост (например §50.5 paper vs спека §5.6) и операционные задачи — в тексте плана и в [`docs/TODO.md`](docs/TODO.md). Graphify: см. [`AGENTS.md`](AGENTS.md).
