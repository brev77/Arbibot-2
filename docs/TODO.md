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
| CI verification | Убедиться, что все CI jobs зелёные на `main` | Локально: `npm run lint && npm run build && npm run test`. Чеклист: [`docs/ci-verification-checklist.md`](ci-verification-checklist.md). **2026-04-20:** полный прогон — успех |
| Полный bus → Kafka | Публикация из `outbox_events` в топик с реальными строками | CI: job **`bus-smoke`** на `main`. Локально: **`npm run ci:bus-smoke`**; `SEED_OUTBOX=1` + **`DATABASE_URL`** — `npm run seed:outbox-smoke-events`. Полный `bus:publish`/`bus:consume` — вручную по [outbox-inbox.md](outbox-inbox.md). |

---

## Drills (регулярные репетиции процедур)

**Цель:** проверить, что on-call процедуры, runbooks, и автоматика действительно работают в ограниченных условиях. Каждый drill имеет явный триггер (когда запускать) и критерий успеха.

**Инструменты автоматизации:** `npm run drill:1` ([`tools/drill-1-paper-incident.mjs`](../tools/drill-1-paper-incident.mjs)) — drill #1 симулятор (preflight + drift injection + alert verification). Полный пролог/epilog см. в [`docs/drill-1-paper-incident.md`](drill-1-paper-incident.md).

| Триггер | Что | Критерий успеха | Runbook |
|---------|-----|-----------------|---------|
| После 1-й недели в paper | **Drill: Paper incident (drift high)** | Alert `PaperDriftBpsHigh` срабатывает < 10m; operator открывает `/incidents`, эскалирует в investigating, закрывает resolved за < 30m | **[`docs/drill-1-paper-incident.md`](drill-1-paper-incident.md)** (`npm run drill:1`), [`docs/incident-response-playbook.md`](incident-response-playbook.md), [`docs/paper-promotion-criteria.md`](paper-promotion-criteria.md) |
| Перед каждым live rollout | **Drill: DEX kill-switch** | Включить `DEX_LIVE_KILL_SWITCH=true`, убедиться что live DEX операции блокируются (paper не затрагивается); выключить и проверить восстановление | [`docs/dex-rollback-strategy.md`](dex-rollback-strategy.md), [`docs/dex-runbook-failed-tx.md`](dex-runbook-failed-tx.md) |
| Каждые 2 недели (staging) | **Drill: Key rotation** | Запустить [`docs/key-rotation-runbook.md`](key-rotation-runbook.md); Vault ключи ротированы, backend сервисы продолжают работать; метрики не падают | [`docs/key-rotation-runbook.md`](key-rotation-runbook.md), [`docs/vault-integration-guide.md`](vault-integration-guide.md) |
| После первой 5xx волны на staging | **Drill: SLO burn alert** | Trigger real or simulated 5xx spike; убедиться, что `SLOFastBurnCritical` / `SLOSlowBurnCritical` активируются и Alertmanager дублирует в PagerDuty/Slack | [`docs/observability-tracing.md`](observability-tracing.md), [`infra/alertmanager/`](../infra/alertmanager/) |
| Перед live с реальным капиталом | **Drill: Reconciliation P0** | Искусственно создать mismatch (update portfolio.manual_override); reconciliation service детектирует < 15m; operator проходит P0 procedure | [`docs/reconciliation-p0-procedures.md`](reconciliation-p0-procedures.md) |
| Перед live | **Drill: Disaster recovery (DB restore)** | `pg_dump` snapshot → drop database → restore → verify migrations → smoke test (paper trading). RTO/PO измеряются | [`docs/disaster-recovery-plan.md`](disaster-recovery-plan.md), [`tools/backup-postgres.sh`](../tools/backup-postgres.sh) |
| Ежемесячно (staging) | **Drill: Bridge stuck (cross-chain)** | Имитировать stale bridge transfer (timeout); reconciliation service создаёт incident; operator выполняет `docs/dex-runbook-bridge.md` | [`docs/dex-runbook-bridge.md`](dex-runbook-bridge.md), [`docs/adr-dex2-crosschain.md`](adr-dex2-crosschain.md) |


---

## Pre-deploy risk tracker

> **Назначение:** отслеживание рисков, выявленных разведкой кодовой базы (2026-07-17) перед деплоем.
> Исполнительный план проверки (что/когда запускать) — [`docs/pre-deploy-verification-plan.md`](pre-deploy-verification-plan.md).
> Канон PAPER/LIVE DoD — [`paper-deploy-dod.md`](paper-deploy-dod.md) / [`live-deploy-dod.md`](live-deploy-dod.md).
> **Правило приоритета:** Critical/High = блокеры **live**; для **paper** — проверить или выключить.

### 🔴 Critical (блокеры live-деплоя)

| ID | Риск | Где | paper | live | Владелец | Статус |
|----|------|-----|-------|------|----------|--------|
| **C1** | Bridge fee estimation — заглушки (TODO в across + stargate). Реальные деньги при live bridge. | `apps/execution-orchestrator/src/execution/bridge/across-bridge.adapter.ts:395`, `stargate-bridge.adapter.ts:508` | ОК (paper = simulated) | Реализовать real-time fee ИЛИ disable cross-chain в live config | | ⬜ open |
| **C2** | ~~Тесты `392/392` не подтверждены локально~~ → **✅ RESOLVED (2026-07-17):** Первичное заявление о «SIGTERM + утечках handles» было **false positive** — артефакт способа запуска `turbo run test -- --detectOpenHandles` (turbo форвардит флаги в no-op пакеты типа tsconfig/contracts, где `node -e` падает на неизвестных CLI-флагах). Прогон per-package с `--detectOpenHandles`: `@arbibot/messaging` PASS 3/3 за 6.2s, `canonical-market` PASS 11/11 за 13s, `market-intake` PASS 8/8 за 13s, `portfolio` PASS 13/13 за 13s — **0 утечек handles**. Turbo `npm run test` (с кэшем) → **29/29 пакетов green**. | — | — | | ✅ resolved |
| **C3** | `audit-service` — 0 unit-тестов (compliance-trail непроверен). | `apps/audit-service/` | ОК (audit append-only, low risk) | Добавить spec на `audit.service.ts` | | ⬜ open |

### 🟠 High (блокеры live-деплоя; для paper — проверить)

| ID | Риск | Где | paper | live | Владелец | Статус |
|----|------|-----|-------|------|----------|--------|
| **H1** | ~~Hardcoded salt в `KeyVaultService`~~ → **сужен до Medium (2026-07-17):** hardcoded salt `'arbibot-vault-salt-v1'` используется только для master key derivation (`scryptSync` строка 84). Per-key encryption использует **random salt** (`randomBytes(32)` строка 125). Приемлемо, если `PRIVATE_KEY_ENCRYPTION_KEY` уникален per-deploy. | `packages/nest-platform/src/vault/key-vault.service.ts:84` | Принять | Подтвердить что `PRIVATE_KEY_ENCRYPTION_KEY` уникален per-deploy; (опц.) migrate на KMS | | ⬜ open (Medium) |
| **H2** | API key comparison **timing-unsafe** в `HermesAuthGuard` (не constant-time). | `apps/hermes-gateway/src/.../hermes-auth.guard.ts` | Принять (network-isolated) | `crypto.timingSafeEqual` | | ⬜ open |
| **H3** | `config-service/panic.service` без unit-тестов (panic button — деструктивный путь). | `apps/config-service/src/.../panic.service.ts` | Принять (UI tested) | Добавить spec | | ⬜ open |
| **H4** | `token-approve.service` без unit-тестов (ERC-20 approve перед swap — ошибки = потеря средств). | `apps/execution-orchestrator/src/.../token-approve.service.ts` | Принять (paper = simulated) | Добавить spec | | ⬜ open |
| **H5** | `paper-capital.service` без unit-тестов (резервирование виртуальных средств). | `apps/paper-trading-service/src/.../paper-capital.service.ts` | Принять (E2E покрывает) | Добавить spec | | ⬜ open |

### 🟡 Medium (не блокеры; отслеживать)

| ID | Риск | Действие | Статус |
|----|------|----------|--------|
| **M1** | Dev session secret fallback (fail-closed в prod, но проверить) | Проверить в Фазе 2 чек-листа | ⬜ open |
| **M2** | Across `outputAmount = amount` (без учёта мостовой комиссии) | Связано с C1; закрыть вместе | ⬜ open |
| **M3** | Native bridge dead address + OP withdrawal correlation | Review при live | ⬜ open |
| **M5** | CD pipeline не имеет deploy step (только build+push в GHCR) | Документировать manual `docker compose pull && up -d` ИЛИ добавить deploy job | ⬜ open |
| **M6** | Миграции не применяются автоматически при deploy (нет one-shot migrator контейнера) | Добавить migrator контейнер в compose ИЛИ запустить `npm run db:migrate` перед `up -d` | ⬜ open |
| **M7** | TLS сертификаты должны предоставляться извне (`infra/nginx/ssl/` пустой) | Let's Encrypt ИЛИ `tools/generate-tls-certs.sh` для self-signed (paper) | ⬜ open |
| **M8** | Backup стратегия не автоматизирована (нет pg_dump cron/WAL archiving в compose) | Добавить backup-сервис в compose (см. [`docs/disaster-recovery-plan.md`](disaster-recovery-plan.md)) | ⬜ open |
| **M9** | `node_exporter` отсутствует → `DiskSpaceLow` alert будет без данных | Добавить node_exporter ИЛИ убрать `DiskSpaceLow` из `alerts.yml` | ⬜ open |
| **M10** | Hermes Agent в compose — это шаблон на `python:3.11-slim` (публичного образа нет) | Собрать образ агента вручную | ⬜ open |

### 🟢 Low (tech debt / cosmetic)

| ID | Риск | Действие | Статус |
|----|------|----------|--------|
| **L1** | Test mnemonic allowlist | ОК (правильно исключён из сканов) | ✅ no-op |
| **L2** | `console.error` в startup | Cleanup при возможности | ⬜ open |
| **L3** | `PRIVATE_KEY_ENCRYPTION_KEY` не в validator | Добавить в `validate-env.sh` | ⬜ open |
| **L4** | Prettier не настроен | Добавить `.prettierrc` + `format` скрипт | ⬜ open |
| **L5** | Web UI ~3% test coverage (4 файла на 135 ts/tsx) | Нарастить UI-тесты (backlog) | ⬜ open |
| **L6** | Крупные файлы execution-orchestrator (native-bridge 928 LOC) | Рефакторинг (backlog) | ⬜ open |
| **L7** | Конфликт порта 3000: Next.js vs risk-service (локально) | Документировать (только dev) | ⬜ open |

**Снято:** ~~M4 — корневые `*.log` файлы~~. Уже исключены через `*.log` в `.gitignore` — локальные артефакты, в git не попадают.

### Легенда статусов

- ⬜ open — не начато · 🔄 in-progress · ✅ done · ⏭️ descoped (с указанием причины)

---

## В очереди (бэклог из плана / техдолг)

| Когда | Что | Связь с планом |
|--------|-----|----------------|
| По мере появления writer-путей | ~~**Watchlist auto-tiering / route scoring writers**~~ — **сделано (2026-04-19):** `WatchlistTieringWriterService` / `RouteScoringWriterService`, `PolicyJobsService` + `POST /policy/jobs/*`, см. `docs/watchlist-tiering-logic.md`, `docs/route-scoring-logic.md`, `npm run e2e:phase2-watchlist-route-scoring`; **CI (2026-04-19):** `npm run ci:e2e-phase2-watchlist-route-scoring`, job **`e2e-phase2-watchlist-route-scoring`** в [`.github/workflows/ci.yml`](../.github/workflows/ci.yml) | `PRIO-P2-TIER`, `PRIO-P2-SCORE` → `done` |
| Phase 1+ по необходимости | **Интеграционный / e2e** сценарий: snapshot → … → risk → reserve → arm — `npm run e2e:phase1-foundation` ([`tools/e2e-phase1-foundation-chain.mjs`](../tools/e2e-phase1-foundation-chain.mjs)) | DoD §50.3 в `DEVELOPMENT_PLAN.md`; отдельного `step_id` нет |
| Phase 2 | **`npm run e2e:phase2-controlled-execution`** — полный контур ног до `plan.completed` ([`tools/e2e-phase2-controlled-execution.mjs`](../tools/e2e-phase2-controlled-execution.mjs)); в CI: job **`e2e-phase2`** + **`npm run ci:e2e-phase2`** ([`tools/ci-e2e-phase2.sh`](../tools/ci-e2e-phase2.sh)); multi-leg: `EXECUTION_BEGIN_LEG_COUNT` на orchestrator | `P2-2.1-EPL` |
| По желанию | **Post-gate HTTP venue:** расширить таксономию 4xx (per-venue mapping), dedupe нагрузочные тесты — базово уже есть `VENUE_HTTP_TIMEOUT_MS`, `x-correlation-id`, `submitIdempotencyKey`, transient **408**, lab echo correlation | follow-up к `P2-2.1-VEN` |
| По мере стабилизации | Расширить smoke / consumers под новые `eventName` в envelope (`LegFilled`, `PlanCompleted`) | Bridge уже публикует типы; smoke логирует `entityType`; in-DB relay по-прежнему только `RiskDecisionIssued` |
| ~~Перед live rollout (P0)~~ | ~~**Alertmanager → `/incidents` пайплайн**~~ — **сделано (2026-06-15):** webhook receiver `POST /alerts/webhook` + `GET /alerts` в `reconciliation-service` (`AlertIncidentsService`, `AlertsController`, `AlertmanagerIncidentEntity` migration `037_alertmanager_incidents.sql`); `alertmanager.yml` route на reconciliation; BFF `/api/operator/alerts` + `/incidents` показывает drill-алерты (PaperDriftBpsHigh, SLO burn) | Из `docs/drill-1-paper-incident.md` gap #1 → **closed** |
| ~~Перед live rollout~~ | ~~**`arb_paper_drift_bps_current` self-heal**~~ — **сделано (2026-06-15):** `PaperDriftGaugesWorker` (periodic, configurable `PAPER_DRIFT_GAUGES_REFRESH_INTERVAL_MS`) + `POST /paper/admin/drift-gauges/refresh` manual endpoint в `paper-trading-service` | Из `docs/drill-1-paper-incident.md` gap #3 → **closed** |
| ~~Опционально~~ | ~~**HERMES dev-конфигурация**~~ — **сделано (2026-06-15):** RBAC relaxed в `apps/web/app/api/operator/hermes/v1/[[...path]]/route.ts`: **GET** (read-only) доступен `OPERATOR`+`ADMIN`, **POST/PATCH** (mutations) требуют `ADMIN` (audit-trail preserved); drill-оператор видит `/hermes` без эскалации | Из `docs/drill-1-paper-incident.md` gap #2 → **closed** |
| ~~Опционально~~ | ~~**Уменьшить MTTR для `PaperDriftBpsSustainedHigh`**~~ — **сделано (2026-06-15):** `infra/prometheus/alerts.yml` — `PaperDriftBpsSustainedHigh` `for: 15m` → `for: 10m` для drill/staging; SLO multi-window alerts оставлены без изменений (production-grade) | Из `docs/drill-1-paper-incident.md` gap #4 → **closed** |
---

## Идеи / не забыть

- Документ для smoke-consumer: в топике теперь несколько `eventName` в envelope — при расширении UI/алертов учитывать парсинг.
- После крупных правок в `@arbibot/contracts`: **`npm run build -w @arbibot/contracts`** перед локальными тестами зависимых приложений (иначе устаревший `dist`).

---

## Сделано (краткий журнал)

| Дата | Что |
|------|-----|
| 2026-04-20 | **bus-smoke локально (Docker Desktop, Windows):** эквивалент `ci-bus-smoke` — compose **bus** profile up, пауза, `npm run build -w @arbibot/outbox-kafka-bridge`, проверка `dist/bin/publish.js` / `consume.js`, compose down — **успех** (PowerShell; WSL/bash без `docker.sock` см. [`tools/ci-bus-smoke.sh`](../tools/ci-bus-smoke.sh)). |
| 2026-04-20 | Phase 5 **`P5-5-GW`**: `HERMES-gateway` — **`GET /HERMES/v1/*`** (plans, positions, incidents, dashboard summary), **`HERMESAuthGuard`**; **`apps/web`** BFF **`/api/operator/HERMES/v1/[[...path]]`**, read-only **`/HERMES`**; docs **`apps/HERMES-gateway/README.md`**, **`docs/HERMES-gateway-runbook.md`**. CI: **`e2e-phase4-tier-routing`** / **`bus-smoke`** — зелёный прогон на **GitHub `main`** + локальный bus-smoke при наличии Docker (см. строку выше). |
| 2026-04-20 | Phase 5 HERMES: mutations on **`HERMES-gateway`** (`arm`, `execute`, `resolve incident`, `safe-mode`, position close **501**), read **`incident-briefs`**, **`approvals-queue`**, **`sessions`**, **`safe-mode/status`**; BFF **POST/PATCH**; UI **`HERMESWorkspace`**, **`SafeModeBanner`**; tools **`seed:outbox-smoke-events`**, **`venue:load-test`**; docs **ci-verification-checklist**, **e2e-scenarios**, **intake-degradation-runbook**, **HERMES-ui-design**, **HERMES-safe-mode-runbook**; `P5-5-OAPI` / `P5-5-OCUI` / `P5-5-BRIEF` → **done** в `DEVELOPMENT_PLAN.md`. |
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

| 2026-04-20 | **План стабилизации CI (1 мес.) — репо:** `npm run db:verify-migrations:all`, чеклисты [`docs/ci-verification-checklist.md`](ci-verification-checklist.md) + [`docs/grafana-dashboard-verification.md`](grafana-dashboard-verification.md), `VENUE_HTTP_ERROR_CATEGORY_MAP`, метрики `arb_HERMES_safe_mode_redis_errors_total`, SQL replay в [`docs/phase4-prep-bridge.md`](phase4-prep-bridge.md), Jest `tsconfig.spec.json` в config-service, `playbookConfig` в `legs.service.spec.ts`. |
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
| 2026-05-21 | **DEX-2 cross-chain fully complete (session 37):** `DEX-2-0-ADR` → `DEX-2-4-E2E` — все 7 шагов `done`. 3 bridge adapter (Across, Stargate, Native L2), `MultiLegPlanBuilder`, `CrossChainReconciliationService` + worker, multi-chain E2E. 27 suites, 392/392 tests pass. Build 21/21 ✅, Lint 28/28 ✅ |
| 2026-05-21 | **DEX-DOC complete (session 38):** `DEX-DOC-RUNBOOK-BRIDGE` + `DEX-DOC-ROLLBACK` → `done`. **Все 46/46 DEX шагов завершены.** Документация синхронизирована (progress.md, TODO.md, AGENTS.md) |
| 2026-05-21 | **RpcProviderManager tests expanded:** 11→22 тестов (init/destroy, primary-only, error handling, health check success/failure, metrics, edge cases). **27 suites, 392/392 tests pass.** |
| 2026-05-21 | **Pre-deploy review gate:** создан [`docs/pre-deploy-review.md`](pre-deploy-review.md) — consolidated pre-deploy чеклист (10 разделов, PAPER-READY vs LIVE-READY режимы, findings F1–F5, gate-sequence stages 0–7, методология верификации, sign-off). 5 findings: F1 (backend без auth guard, network-isolation only), F2 (`OPENCLAW_*` → `HERMES_*` в `tools/validate-env.sh`), F3 (`tools/verify-deployment.sh` проверяет прямые порты не публикуемые в prod), F4 (`ARBIBOT_DEV_ROLE` env-fallback активен в prod), F5 (`deployment-readiness-assessment.md` маркировка PAPER vs LIVE). Cross-link добавлен в [`docs/deployment-readiness-assessment.md`](deployment-readiness-assessment.md). F1–F4 заведены как backlog (отдельная задача). |

| 2026-06-13 | **Pre-deploy readiness hardening (session 41):** operator destructive actions — `paper-promotion-table.tsx` (Approve/Reject) и `paper-trades-table.tsx` (Approve/Reject/Cancel) обёрнуты в `DestructiveOperatorAction` (impact preview + typed-phrase confirm); SLO multi-window multi-burn-rate alerts (4 rules в `infra/prometheus/alerts.yml`, по Google SRE Workbook §5); drills-секция добавлена в этот файл с триггерами/критериями/runbooks. Lint 28/28 ✅, build 21/21 ✅ (после верификации). |
| 2026-06-13 | **Drill #1 automation tooling (session 42):** создан симулятор [`tools/drill-1-paper-incident.mjs`](../tools/drill-1-paper-incident.mjs) (preflight → rule loaded → baseline → SQL-инъекция drift 75 bps → polling Prometheus + Alertmanager → pass/fail отчёт); runbook [`docs/drill-1-paper-incident.md`](drill-1-paper-incident.md) (prerequisites, criteria DoD, MTTA/MTTR logging, troubleshooting); npm-скрипт `npm run drill:1`. Локальный прогон заблокирован: Docker daemon не запущен, dev-stack не поднят (Postgres:15432, paper:3018, prometheus:9090, alertmanager:9093 отсутствуют). Drill ждёт поднятия среды. |
| 2026-06-15 | **Drill #1 first live run (session 43):** Полный прогон на поднятом dev-стеке. **Auto PASS (6/6):** preflight ✅, alert rule loaded ✅, baseline ✅, 25 drift samples injected (DRILL-BTC-USDC, 76 bps) via `POST /paper/drift-samples` ✅, `PaperDriftBpsHigh` firing @ t≈715s ✅, Alertmanager active ✅. **Manual PARTIAL:** Alertmanager UI ✅, `/paper` drift table ✅, `/incidents` GAP, `/hermes` GAP. **Cleanup:** DELETE 25 DRILL-* samples + restart paper-trading-service → `PaperDriftBpsHigh` RESOLVED @ T+~5m, `PaperDriftBpsSustainedHigh` RESOLVED @ T+~20m. Final verify: `max_15m`=0 series, `current`=0 series, DB drill_samples_left=0. **4 gaps** заведены в backlog выше. См. [`docs/drill-1-paper-incident.md`](drill-1-paper-incident.md). |
| 2026-06-15 | **Drill #1 gaps closed (session 44):** Все 4 gap из drill #1 реализованы и верифицированы (lint 29/29 ✅, build 22/22 ✅, tests 392/392 ✅). **#1:** `AlertIncidentsService` + `AlertsController` в reconciliation-service (migration `037_alertmanager_incidents.sql`, `AlertmanagerIncidentEntity`, severity normalization, fingerprint dedup, `firing`↔`resolved_external` state machine, 14 unit tests в `alert-incidents.service.spec.ts`); `infra/alertmanager/alertmanager.yml` route → reconciliation webhook; BFF `/api/operator/alerts` в apps/web; `/incidents` UI merge reconciliation + alerts. **#2:** RBAC relaxed в BFF `/api/operator/hermes/v1/*` — GET доступен `OPERATOR`+, POST/PATCH требуют `ADMIN` (audit preserved). **#3:** `PaperDriftGaugesWorker` + `POST /paper/admin/drift-gauges/refresh` в paper-trading-service (configurable interval). **#4:** `infra/prometheus/alerts.yml` `PaperDriftBpsSustainedHigh` `for: 15m`→`for: 10m`. |

*Последняя актуализация файла: 2026-07-17 (pre-deploy risk tracker C1–C3 / H1–H5 / M1–M10 / L1–L7 добавлен; исполнительный план — [`docs/pre-deploy-verification-plan.md`](pre-deploy-verification-plan.md)).*
