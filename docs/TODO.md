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
| После мержа Phase 4 e2e | Убедиться, что job **`e2e-phase4-tier-routing`** зелёный на `main` (проверка в GitHub Actions) | Локально: `npm run ci:e2e-phase4-tier-routing` (Postgres + сервисы из скрипта). Чеклист: [`docs/ci-verification-checklist.md`](ci-verification-checklist.md). **2026-04-20:** полный **`npm run lint` / `build` / `test`** из корня — успех; см. [`docs/review-handoff-2026-04-20.md`](review-handoff-2026-04-20.md). |
| Полный bus → Kafka | Публикация из `outbox_events` в топик с реальными строками | CI: job **`bus-smoke`** на `main` (GitHub Actions). Локально: **`npm run ci:bus-smoke`**; опционально `SEED_OUTBOX=1` + **`DATABASE_URL`** — вставка строки через **`npm run seed:outbox-smoke-events`**. Полный `bus:publish`/`bus:consume` — вручную по [outbox-inbox.md](outbox-inbox.md). |

---

## В очереди (бэклог из плана / техдолг)

| Когда | Что | Связь с планом |
|--------|-----|----------------|
| По мере появления writer-путей | ~~**Watchlist auto-tiering / route scoring writers**~~ — **сделано (2026-04-19):** `WatchlistTieringWriterService` / `RouteScoringWriterService`, `PolicyJobsService` + `POST /policy/jobs/*`, см. `docs/watchlist-tiering-logic.md`, `docs/route-scoring-logic.md`, `npm run e2e:phase2-watchlist-route-scoring`; **CI (2026-04-19):** `npm run ci:e2e-phase2-watchlist-route-scoring`, job **`e2e-phase2-watchlist-route-scoring`** в [`.github/workflows/ci.yml`](../.github/workflows/ci.yml) | `PRIO-P2-TIER`, `PRIO-P2-SCORE` → `done` |
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
| 2026-04-20 | **bus-smoke локально (Docker Desktop, Windows):** эквивалент `ci-bus-smoke` — compose **bus** profile up, пауза, `npm run build -w @arbibot/outbox-kafka-bridge`, проверка `dist/bin/publish.js` / `consume.js`, compose down — **успех** (PowerShell; WSL/bash без `docker.sock` см. [`tools/ci-bus-smoke.sh`](../tools/ci-bus-smoke.sh)). |
| 2026-04-20 | Phase 5 **`P5-5-GW`**: `openclaw-gateway` — **`GET /openclaw/v1/*`** (plans, positions, incidents, dashboard summary), **`OpenclawAuthGuard`**; **`apps/web`** BFF **`/api/operator/openclaw/v1/[[...path]]`**, read-only **`/openclaw`**; docs **`apps/openclaw-gateway/README.md`**, **`docs/openclaw-gateway-runbook.md`**. CI: **`e2e-phase4-tier-routing`** / **`bus-smoke`** — зелёный прогон на **GitHub `main`** + локальный bus-smoke при наличии Docker (см. строку выше). |
| 2026-04-20 | Phase 5 OpenClaw: mutations on **`openclaw-gateway`** (`arm`, `execute`, `resolve incident`, `safe-mode`, position close **501**), read **`incident-briefs`**, **`approvals-queue`**, **`sessions`**, **`safe-mode/status`**; BFF **POST/PATCH**; UI **`OpenclawWorkspace`**, **`SafeModeBanner`**; tools **`seed:outbox-smoke-events`**, **`venue:load-test`**; docs **ci-verification-checklist**, **e2e-scenarios**, **intake-degradation-runbook**, **openclaw-ui-design**, **openclaw-safe-mode-runbook**; `P5-5-OAPI` / `P5-5-OCUI` / `P5-5-BRIEF` → **done** в `DEVELOPMENT_PLAN.md`. |
| 2026-04-21 | Phase 4 краткосрочный план: миграция **`029_intake_policy_seed.sql`** (`intake.throttling`, `intake.routing.tiers`); `tools/seed-intake-policy-config.mjs`; `npm run e2e:phase4-tier-routing`, `ci:e2e-phase4-tier-routing.sh`, jobs **`e2e-phase4-tier-routing`** / **`bus-smoke`** в CI; `docs/intake-policy-config-keys.md`; `npm run ci:bus-smoke`; `P4-4-TIER` / `P4-4-UI` / шаг **`P4-4-TIER-ROUTING-E2E`** → `done` в `DEVELOPMENT_PLAN.md`. |
| 2026-04-19 | Phase 4 prep: CI `ci:e2e-phase2-watchlist-route-scoring` + Grafana `infra/grafana/dashboards/arbibot-risk-policy-writers.json`; BFF `GET /api/operator/settings/watchlist-tiers`; `/settings` блок watchlist tiers; docs `phase4-prep-bridge.md`, `adr-phase4-intake-throttling.md`, `phase4-ui-degraded-signals.md`; `npm run export:route-scoring-history`. |
| 2026-04-19 | Краткосрочный план 2–3 недели: adaptive `evaluate-risk`, policy read APIs (watchlist tiers, route scoring history), migrations `024`–`028`, execution `playbook_config` + partial-fill playbook service + doc, paper promotion quality fields + `docs/paper-promotion-criteria.md`, drift `route_key`, recalibration `tools/recalibration`, histogram bucket doc, исправления `020`/`024` SQL. |
| 2026-04-17 | Phase 3 slice: `@arbibot/paper-trading-service` (порт 3018), миграция `016_paper_trading.sql`, BFF `PAPER_API_BASE`, UI `/paper` + `/tokens` (read), `POST /opportunities/:id/paper-enqueue` → paper queue; матрица `PRIO-P1-PROF`/`ADRISK`/`SIZE`/`PLAY` синхронизирована с `P2-2.2-*` в `DEVELOPMENT_PLAN.md`. |
| 2026-04-16 | «Дожать начатое»: `docs/reconciliation-p0-procedures.md`, `PRIO-P0-RECON` / `P2-2.2-*` / `PRIO-P1-ALERT` / FE-ROUTE (dashboard, portfolio, opportunities, settings) в `DEVELOPMENT_PLAN.md`; миграция `015`, профили риска + `GET /policy/*-profiles`, метрика `arb_execution_leg_partial_fill_commits_total`, HTTP venue **408**, lab `x-correlation-id`, smoke `entityType`, `MismatchesService` jest, `docs/outbox-inbox.md` / `observability-tracing.md` / `phase2-risk-policy-roadmap.md`. |
| 2026-04-16 | Phase 2.1 gate: CI job **`e2e-phase2`** (`tools/ci-e2e-phase2.sh`, `HttpVenueAdapter` + `lab-venue-stand.mjs`), `npm run ci:e2e-phase2`, актуализация `DEVELOPMENT_PLAN` / `TODO` / settlement doc. |
| 2026-04-16 | Phase 2.1 slice: venue terminal/transient errors, `EXECUTION_BEGIN_LEG_COUNT`, `e2e:phase2-controlled-execution`, `014`/`routeKey`/`instrumentKey` resolution, settlement DoD + simulate env, incidents UI `investigating`→`resolved`, alert row `ReconciliationOpenMismatches`, P2-2.2 scope freeze в плане/TODO. |
| 2026-04-12 | Transactional outbox **`CapitalReserved`** (`capital-service`), **`PlanArmed`** (`execution-orchestrator`); Kafka bridge публикует **`SnapshotUpdated`**, **`CapitalReserved`**, **`PlanArmed`**; обновлены `docs/outbox-inbox.md`, `docs/services.md`, `README.md`, `AGENTS.md`, checkpoint в `DEVELOPMENT_PLAN.md`. |
| 2026-04-12 | План roadmap: Grafana dashboard, ExecutionLeg flow + mock venue, portfolio/reconciliation сервисы, `/incidents`→reconciliation API, policy readiness, миграции `009`–`011`, обновления `DEVELOPMENT_PLAN.md` / `AGENTS.md` / contracts. |
| 2026-04-12 | Корневой **`npm run lint` / `build` / `test`** — успех после правок CI/lint (nest-platform `tsconfig.build`, messaging/nest-platform/orchestrator specs, web eslint ignore `postcss.config.mjs`). **`P0-0.4-DOCK`** / **`P0-0.4-VER`** → `done` в `DEVELOPMENT_PLAN.md`; политика схем — `docs/async-events.md`. |
| 2026-04-12 | **P2-2.1-RECON:** детектор `completed_plan_missing_portfolio`, `POST /mismatches/run-detectors`, BFF + кнопка на `/incidents`. **OIB:** outbox + Kafka bridge для **`LegFilled`** / **`PlanCompleted`** (execution-orchestrator). **Layout:** единый access-panel (Home / Dashboard) при `session === null` и на `/` при `forbidden=1`. **`.env.example`:** `EXECUTION_SETTLEMENT_ENABLED`, `PORTFOLIO_SERVICE_URL`. |
| 2026-04-13 | Near-term план: `npm run e2e:phase1-foundation`, `docs/settlement-post-commit.md`, retries settlement, ключ позиций `arb:execution:{planId}:leg:{n}`, `MOCK_VENUE_FAIL_SUBMIT_REMAINING`, второй детектор reconciliation + `PATCH /mismatches/:id`, UI `/portfolio` и `/incidents`, SLO draft в observability, лог `eventName` в smoke-consumer. |

| 2026-04-20 | **План стабилизации CI (1 мес.) — репо:** `npm run db:verify-migrations:all`, чеклисты [`docs/ci-verification-checklist.md`](ci-verification-checklist.md) + [`docs/grafana-dashboard-verification.md`](grafana-dashboard-verification.md), `VENUE_HTTP_ERROR_CATEGORY_MAP`, метрики `arb_openclaw_safe_mode_redis_errors_total`, SQL replay в [`docs/phase4-prep-bridge.md`](phase4-prep-bridge.md), Jest `tsconfig.spec.json` в config-service, `playbookConfig` в `legs.service.spec.ts`. |
| 2026-04-20 | **Phase 4 closure:** [`docs/route-scoring-replay.md`](route-scoring-replay.md), `npm run replay:route-scoring-export`, [`docs/adr-phase4-clickhouse-gate.md`](adr-phase4-clickhouse-gate.md), раздел analytics path в [`docs/observability-tracing.md`](observability-tracing.md); `P4-4-SCORE` / `P4-4-CH` → `done` в `DEVELOPMENT_PLAN.md`. |

| 2026-04-28 | **DEX Code Review:** Проведена ревизия реализованных DEX компонентов. Найдены 3 критических блокера:
  - 🔴 Blocker 1: `getEncryptedKey` не реализован в WalletManager (выбрасывает ошибку)
  - 🔴 Blocker 2: Сервисы не зарегистрированы в DI контуре (нет execution.module.ts)
  - 🔴 Blocker 3: Несоответствие типов encryptionKey в Vault (string vs Buffer)
  - ⚠️ Дополнительно: отсутствуют unit-тесты, метрики названы неправильно, нет automatic recovery в RpcProviderManager
  - Рекомендация: Приостановить разработку новых фич, исправить 3 блокера, создать базовые unit tests |
| 2026-04-28 | **DEX план:** Обновлен DEVELOPMENT_PLAN-DEX.md с review notes для реализованных шагов. Информация о ревизии теперь хранится в плане, отдельный файл dex-code-review-summary.md удален |
| 2026-04-28 | **Policy:** Все задачи по выполнению плана DEX вносить в `.cursor/plans/DEVELOPMENT_PLAN-DEX.md` в соответствующие разделы `review_notes` / `review_action_items` / `review_blocks` |
| 2026-04-28 | **Policy:** Задачи не из DEX плана вносить в `docs/TODO.md` (этот файл) |

*Последняя актуализация файла: 2026-04-28 (DEX code review, блокеры, policy updates).*
  +++++++ REPLACE
