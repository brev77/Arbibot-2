# Рабочий список (что / когда)

Файл для **оперативного** трекинга: сроки, напоминания, мелкие задачи вне полного lifecycle шагов в [.cursor/plans/DEVELOPMENT_PLAN.md](../.cursor/plans/DEVELOPMENT_PLAN.md).

**Первичный запуск:** каноничная последовательность **paper → статистика → live с минимальным капиталом** описана в плане (раздел «Операционная последовательность первичного запуска») и в [`docs/services.md`](services.md).

**Правила ведения**

- Канон приоритетов и статусов шагов — в `DEVELOPMENT_PLAN.md` (поля `step_id`, `status`, `review_required`).
- Здесь: конкретные действия, владелец по желанию, **дедлайн или «когда»** (дата или триггер: «после мержа X»).
- После выполнения пункта — перенос вниз в «Сделано» с датой или удаление, чтобы список оставался читаемым.

---

## Срочно / следующий чек

| Когда | Что | Заметки |
|--------|-----|--------|
| При проверке bus | Убедиться, что `npm run bus:publish` поднимает профиль `bus` и публикует записи с `SnapshotUpdated`, `CapitalReserved`, `PlanArmed`, `LegFilled`, `PlanCompleted` | Требуются `DATABASE_URL`, `KAFKA_BROKERS` (см. `.env.example`); без них скрипт завершится с ошибкой — см. [outbox-inbox.md](outbox-inbox.md), [AGENTS.md](../AGENTS.md) |

---

## В очереди (бэклог из плана / техдолг)

| Когда | Что | Связь с планом |
|--------|-----|----------------|
| После `done` по блоку `P2-2.1-*` | **P2-2.2 не блокирует DoD §50.4:** профили в БД, adaptive risk в evaluate, исполняемые playbooks — стартовать после закрытия Phase 2.1 (см. freeze в `DEVELOPMENT_PLAN.md`, 2026-04-16) | `P2-2.2-PROF`, `P2-2.2-ADRISK`, `P2-2.2-PLAY` |
| Phase 1+ по необходимости | **Интеграционный / e2e** сценарий: snapshot → … → risk → reserve → arm — `npm run e2e:phase1-foundation` ([`tools/e2e-phase1-foundation-chain.mjs`](../tools/e2e-phase1-foundation-chain.mjs)) | DoD §50.3 в `DEVELOPMENT_PLAN.md`; отдельного `step_id` нет |
| Phase 2 | **`npm run e2e:phase2-controlled-execution`** — полный контур ног до `plan.completed` ([`tools/e2e-phase2-controlled-execution.mjs`](../tools/e2e-phase2-controlled-execution.mjs)); в CI: job **`e2e-phase2`** + **`npm run ci:e2e-phase2`** ([`tools/ci-e2e-phase2.sh`](../tools/ci-e2e-phase2.sh)); multi-leg: `EXECUTION_BEGIN_LEG_COUNT` на orchestrator | `P2-2.1-EPL` |
| По желанию | **Post-gate HTTP venue:** расширить таксономию 4xx (per-venue mapping), dedupe нагрузочные тесты — базово уже есть `VENUE_HTTP_TIMEOUT_MS`, `x-correlation-id`, `submitIdempotencyKey`, transient **408**, lab echo correlation | follow-up к `P2-2.1-VEN` |
| По мере стабилизации | Расширить smoke / consumers под новые `eventName` в envelope (`LegFilled`, `PlanCompleted`) | Bridge уже публикует типы; smoke логирует `entityType`; in-DB relay по-прежнему только `RiskDecisionIssued` |
---

## Идеи / не забыть

- Документ для smoke-consumer: в топике теперь несколько `eventName` в envelope — при расширении UI/алертов учитывать парсинг.
- После крупных правок в `@arbibot/contracts`: **`npm run build -w @arbibot/contracts`** перед локальными тестами зависимых приложений (иначе устаревший `dist`).

---

## Сделано (краткий журнал)

| Дата | Что |
|------|-----|
| 2026-04-16 | «Дожать начатое»: `docs/reconciliation-p0-procedures.md`, `PRIO-P0-RECON` / `P2-2.2-*` / `PRIO-P1-ALERT` / FE-ROUTE (dashboard, portfolio, opportunities, settings) в `DEVELOPMENT_PLAN.md`; миграция `015`, профили риска + `GET /policy/*-profiles`, метрика `arb_execution_leg_partial_fill_commits_total`, HTTP venue **408**, lab `x-correlation-id`, smoke `entityType`, `MismatchesService` jest, `docs/outbox-inbox.md` / `observability-tracing.md` / `phase2-risk-policy-roadmap.md`. |
| 2026-04-16 | Phase 2.1 gate: CI job **`e2e-phase2`** (`tools/ci-e2e-phase2.sh`, `HttpVenueAdapter` + `lab-venue-stand.mjs`), `npm run ci:e2e-phase2`, актуализация `DEVELOPMENT_PLAN` / `TODO` / settlement doc. |
| 2026-04-16 | Phase 2.1 slice: venue terminal/transient errors, `EXECUTION_BEGIN_LEG_COUNT`, `e2e:phase2-controlled-execution`, `014`/`routeKey`/`instrumentKey` resolution, settlement DoD + simulate env, incidents UI `investigating`→`resolved`, alert row `ReconciliationOpenMismatches`, P2-2.2 scope freeze в плане/TODO. |
| 2026-04-12 | Transactional outbox **`CapitalReserved`** (`capital-service`), **`PlanArmed`** (`execution-orchestrator`); Kafka bridge публикует **`SnapshotUpdated`**, **`CapitalReserved`**, **`PlanArmed`**; обновлены `docs/outbox-inbox.md`, `docs/services.md`, `README.md`, `AGENTS.md`, checkpoint в `DEVELOPMENT_PLAN.md`. |
| 2026-04-12 | План roadmap: Grafana dashboard, ExecutionLeg flow + mock venue, portfolio/reconciliation сервисы, `/incidents`→reconciliation API, policy readiness, миграции `009`–`011`, обновления `DEVELOPMENT_PLAN.md` / `AGENTS.md` / contracts. |
| 2026-04-12 | Корневой **`npm run lint` / `build` / `test`** — успех после правок CI/lint (nest-platform `tsconfig.build`, messaging/nest-platform/orchestrator specs, web eslint ignore `postcss.config.mjs`). **`P0-0.4-DOCK`** / **`P0-0.4-VER`** → `done` в `DEVELOPMENT_PLAN.md`; политика схем — `docs/async-events.md`. |
| 2026-04-12 | **P2-2.1-RECON:** детектор `completed_plan_missing_portfolio`, `POST /mismatches/run-detectors`, BFF + кнопка на `/incidents`. **OIB:** outbox + Kafka bridge для **`LegFilled`** / **`PlanCompleted`** (execution-orchestrator). **Layout:** единый access-panel (Home / Dashboard) при `session === null` и на `/` при `forbidden=1`. **`.env.example`:** `EXECUTION_SETTLEMENT_ENABLED`, `PORTFOLIO_SERVICE_URL`. |
| 2026-04-13 | Near-term план: `npm run e2e:phase1-foundation`, `docs/settlement-post-commit.md`, retries settlement, ключ позиций `arb:execution:{planId}:leg:{n}`, `MOCK_VENUE_FAIL_SUBMIT_REMAINING`, второй детектор reconciliation + `PATCH /mismatches/:id`, UI `/portfolio` и `/incidents`, SLO draft в observability, лог `eventName` в smoke-consumer. |

*Последняя актуализация файла: 2026-04-16 (закрытие «дожать начатое»: `PRIO-P0-RECON`, FE-ROUTE, `P2-2.2-*`, bus/smoke/venue follow-up см. `DEVELOPMENT_PLAN` / `docs/reconciliation-p0-procedures.md`).*
