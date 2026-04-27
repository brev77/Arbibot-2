# Session Summary

## 2026-04-27 — Закрытие сессии: анализ DEVELOPMENT_PLAN-DEX.md

**Дата:** 2026-04-27

**Задача:** Провести полный анализ `.cursor/plans/DEVELOPMENT_PLAN-DEX.md`, выявить пробелы и возможности улучшения.

**Статус:** done

**Реализовано:**
- Полный чтение файла (1489 строк) и проверка всех существующих разделов
- Подтверждение: DEX-1.3, DEX-1.4, DEX-2 существуют в плане (предыдущая ошибка исправлена)
- Выявление **6 реальных отсутствующих компонентов** (ранее было неверно):
  * Priority 1 (Critical): TX recovery (DEX-1.2-REC), Cost analysis (DEX-1.2-COST), Security review (DEX-1.2-SEC)
  * Priority 2 (High): Rollout plan (DEX-1.5-ROLL), Rate limiting (DEX-1.6-RATE)
  * Priority 3 (Medium): Testing strategy overview (DEX-TEST-OVERVIEW)
- Предоставлены детальные спецификации для каждого отсутствующего компонента
- Разработана методология самопроверки архитектурных планов

**Ключевые выводы:**
- План хорошо структурирован и включает основные компоненты DEX-исполнения
- Отсутствуют критичные для производства компоненты: восстановление транзакций, анализ затрат, security review
- План не содержит чёткой стратегии развёртывания (rollout plan)
- Нет комплексной стратегии тестирования
- Все компоненты совместимы с архитектурными принципами Arbibot 2 (single-writer, reservation-first)

**Принятые решения:**
1. **Не реализовывать изменения в файле плана** - задача была только в анализе и выявлении пробелов
2. **Ожидать продуктового решения** по 6 выявленным компонентам (какие из них добавить в план)
3. **Использовать разработанную методологию самопроверки** для будущих архитектурных планов

**Следующие шаги:**
- Продуктовое решение: какие из 6 выявленных компонентов добавить в DEVELOPMENT_PLAN-DEX.md
- При необходимости - реализация добавленных компонентов в коде
- Применение методологии самопроверки к другим планам в репозитории

**Изменённые файлы:** только чтение (`.cursor/plans/DEVELOPMENT_PLAN-DEX.md`, `docs/progress.md`, `session_summary.md`)

---

## 2026-04-27 — Анализ и улучшение DEVELOPMENT_PLAN-DEX.md

**Дата:** 2026-04-27

**Фокус:** Глубокий архитектурный анализ DEX-плана, выявление проблем, разработка методологии самопроверки, обновление плана с детализациями для MVP.

**Ключевые решения:**

1. **Методология самопроверки:** разработан чеклист для валидации архитектурных планов (полнота, реализуемость, соответствие принципам, приоритизация)
2. **Архитектурная совместимость:** все DEX-компоненты должны уважать single-writer и reservation-first паттерны Arbibot 2
3. **Приоритизация MVP:** фокус на минимальном наборе DEX-ов и базовых стратегиях
4. **Интеграция с OpenClaw:** DEX-мутации через gateway для аудита
5. **Мониторинг:** метрики и SLO для каждого DEX-компонента

**Открытые вопросы:**
- Конкретный список DEX-ов для MVP (продуктовое решение)
- Выбор между DEX-агрегатором и direct integration
- Стратегия ликвидности и управления slippage
- Минимальный объём для запуска

**Изменённые файлы:**
- `.cursor/plans/DEVELOPMENT_PLAN-DEX.md` — существенно обновлён с детализациями и улучшениями
- `docs/progress.md` — добавлена запись о сессии

**Следующие шаги:** продуктовое подтверждение на DEX-ы, реализация Phase 0, CI/CD для DEX-компонентов, формальный architecture review.

---

## 2026-04-20 — Phase 4: `P4-4-SCORE` + `P4-4-CH` (100% шагов Phase 4)

**Дата:** 2026-04-20

**Фокус:** Runbook replay route scoring (`docs/route-scoring-replay.md`), `tools/replay-route-scoring-export.mjs` + `npm run replay:route-scoring-export`, ADR gate ClickHouse (`docs/adr-phase4-clickhouse-gate.md`), раздел analytics path latency в `docs/observability-tracing.md`; `DEVELOPMENT_PLAN.md` — оба шага → `done`; правки `AGENTS.md`, `phase4-prep-bridge.md`, `route-scoring-logic.md`, `package.json`, handoff в `docs/progress.md`.

**Открыто:** внедрение ClickHouse/DWH после срабатывания порогов ADR; опциональный compose-профиль analytics не добавлялся намеренно.

---

## 2026-04-21 — Закрытие сессии: `/compact` (после плана CI stability)

**Дата:** 2026-04-21

### /compact — Focus: изменённые файлы, принятые решения, открытые вопросы

**Изменённые файлы (область):**

| Область | Файлы |
|--------|--------|
| **Миграции** | `tools/verify-migrations-applied.mjs` (`--all`), корневой `package.json` (`db:verify-migrations:all`) |
| **Документация CI / ops** | `docs/operations/staging-migrations.md`, `docs/ci-verification-checklist.md`, `docs/grafana-dashboard-verification.md` (новый), `infra/grafana/README.md` |
| **HTTP venue** | `apps/execution-orchestrator/src/venue/http-venue.adapter.ts`, `http-venue.adapter.spec.ts`, `.env.example` |
| **OpenClaw** | `apps/openclaw-gateway/src/openclaw/safe-mode-metrics.ts`, `safe-mode.service.ts`, `docs/openclaw-safe-mode-runbook.md` |
| **Phase 4 prep** | `docs/phase4-prep-bridge.md` (SQL replay), `tools/lab-venue-stand.mjs` (ссылка на `venue-load-test`) |
| **Тесты / Jest** | `apps/config-service/tsconfig.spec.json`, `apps/config-service/package.json` (ts-jest → spec tsconfig), `apps/execution-orchestrator/src/legs/legs.service.spec.ts` (`playbookConfig`) |
| **Индекс** | `AGENTS.md`, `docs/TODO.md`, `docs/progress.md`, `session_summary.md` |

**Принятые решения:**

1. **Полная проверка миграций:** `verify-migrations-applied.mjs --all` сверяет все `*.sql` из репо с `schema_migrations`; дефолтный `db:verify-migrations` по-прежнему про **030/031**.
2. **CI checklist:** в `ci-verification-checklist.md` зафиксированы **7** параллельных jobs из `ci.yml` (не 8 — в workflow семь именованных job).
3. **Venue 4xx:** опциональный JSON в `VENUE_HTTP_ERROR_CATEGORY_MAP`; ключи `venueErrorCode` или `STATUS:venueErrorCode`; разрешение через `resolveVenueHttpClientCategory`, кэш сбрасывается `resetVenueHttpClientCategoryMapCache`.
4. **Safe mode Redis:** счётчик `arb_openclaw_safe_mode_redis_errors_total` (`connection` / `get` / `set`); ошибки записи enable/disable пробрасываются наверх после инкремента.
5. **config-service Jest:** `tsconfig.spec.json` extends `@arbibot/tsconfig/nest.json`, чтобы параметрные декораторы компилировались так же, как в `nest build`.

**Открытые вопросы:**

- Зелёный прогон всех jobs GitHub Actions на `main`/PR после пуша (локально `npm run lint` / `build` / `test` — успех после фиксов).
- На каждом окружении: `npm run db:migrate`, при необходимости `npm run db:verify-migrations:all`.
- Полный bus (`bus:publish` / `bus:consume` с seed) и `ci:bus-smoke` — при наличии Docker и корректного `DATABASE_URL` в том же shell (Windows: см. `docs/TODO.md`).
- Multi-replica OpenClaw: общий Redis по runbook; симуляция downtime Redis для алертов — вне автоматизированного прогона в этой сессии.

**Детали реализации:** см. append в [`docs/progress.md`](docs/progress.md) (блок 2026-04-21 — закрытие сессии).

---

## 2026-04-20 — CI stability plan (repo implementation)

**Фокус:** Закрытие пунктов плана «стабилизация CI и верификации (1 месяц)» в коде и документации: полная проверка миграций (`db:verify-migrations:all`), чеклисты CI/Grafana, `VENUE_HTTP_ERROR_CATEGORY_MAP`, метрики Redis safe mode OpenClaw, SQL replay в phase4-prep-bridge, исправление Jest config-service (decorators) и стаба `playbookConfig` в legs tests.

**Ключевые артефакты:** `tools/verify-migrations-applied.mjs --all`, `docs/ci-verification-checklist.md`, `docs/grafana-dashboard-verification.md`, `docs/phase4-prep-bridge.md` (SQL), `apps/openclaw-gateway` safe-mode metrics, `http-venue.adapter.ts` resolve mapping.

**Оператору:** применить миграции и `db:verify-migrations:all` на стендах; проверить GitHub Actions; bus-smoke / полный bus — по [`docs/outbox-inbox.md`](docs/outbox-inbox.md).

---

## 2026-04-21 — Production sprint: handoff (compact)

**Дата:** 2026-04-21

**Фокус:** Краткосрочный план производства — CI-паритет, миграции (verify), OpenClaw multi-instance (доки), bus seed (`seed:outbox-smoke-events:all`), smoke-consumer, HTTP venue 4xx, intake effective в `/settings`, формальный handoff review (`PRIO-P2-PROMO` / `PRIO-P2-RECAL` → `done`).

### Ключевые решения

1. **Локальная верификация = `lint` + `build` + `test`** из корня; правки под ESLint (`partial-fill-playbook`, удаление stray emit в `config-service/src`).
2. **Стенды:** после `db:migrate` — **`npm run db:verify-migrations`** (ожидаются **030** и **031** в `schema_migrations`); инструкции в `docs/operations/staging-migrations.md`.
3. **Multi-instance safe mode:** общий Redis (`REDIS_URL` / `OPENCLAW_SAFE_MODE_REDIS_URL`); чеклист в `docs/openclaw-safe-mode-runbook.md`.
4. **Bus:** `seed:outbox-smoke-events:all` вставляет все типы из allowlist bridge; consumer расширен логами `entityId` и `planId`/`legId` для leg/plan событий.
5. **HTTP venue:** ошибки 4xx несут **`meta`** (`category`, `venueErrorCode` из JSON) для наблюдаемости; тесты на 404 + `venueErrorCode`.
6. **Settings:** BFF **`GET /api/operator/settings/configurations/:configKey/effective`**; UI — только отображение effective JSON для `intake.throttling` и `intake.routing.tiers`.
7. **План:** `docs/review-handoff-2026-04-20.md` + перевод **`PRIO-P2-PROMO`** / **`PRIO-P2-RECAL`** в **`done`** в `DEVELOPMENT_PLAN.md`.

### Открыто на потом

- Зелёный CI на `main`/PR после пуша (все jobs из `ci.yml`).
- Реальное применение миграций и verify на каждом окружении.
- Полный ручной bus E2E на стенде с Docker/Redpanda при необходимости.

**Детали и перечень файлов:** см. блок «2026-04-21 — Закрытие сессии» в [`docs/progress.md`](docs/progress.md).

---

## 2026-04-21 — Закрытие сессии: compact + ключевые решения

**Дата:** 2026-04-21

### /compact — Focus: изменённые файлы, принятые решения, открытые вопросы

**Изменённые файлы:** см. блок «2026-04-21 — Закрытие сессии» в [`docs/progress.md`](docs/progress.md) (перечень путей и документов).

**Принятые решения (ключевые):**

- Закрытие позиции — только в **portfolio-service** (`quantity` → 0), audit + idempotency-таблица; gateway лишь проксирует.
- **Safe mode** — общий store через **Redis** при настроенном URL; иначе память процесса; async API статуса при чтении из Redis.
- **Качество promotion** — persisted поля + фоновый refresh для открытых кандидатов; API предпочитает persisted tier/score, если заданы.
- **Recalibration** — офлайн JSONL → агрегаты → proposed config fragments; применение только через config-service + approval.
- **OpenClaw UI** — позиции и close с двухшаговым подтверждением и `expectedEntityVersion` в теле POST.

**Открытые вопросы:** CI на PR/main после мержа; `db:migrate` 030/031 на стендах; Redis resilience; полный bus E2E.

**Следующие шаги:** как в [`docs/progress.md`](docs/progress.md) (секция 2026-04-21).

---

## 2026-04-20 — Краткосрочный план (1–2 недели): portfolio close, Redis safe mode, PRIO-P2-PROMO/RECAL

**Дата:** 2026-04-20

### /compact

- **Файлы:** `apps/portfolio-service` (`POST /positions/:id/close`, audit, idempotency), `infra/postgres/migrations/030_*.sql`, `031_*.sql`, `packages/persistence` (entity + close idempotency), `apps/openclaw-gateway` (`closePosition`, `SafeModeService` + `ioredis`, async `getState`, DTO `expectedEntityVersion` на базовом mutation DTO), `apps/paper-trading-service` (`PaperPromotionQualityWorker`, quality columns), `apps/web` (`openclaw-workspace` positions + close), `tools/recalibration/main.py`, `AGENTS.md`, `TODO.md`, `DEVELOPMENT_PLAN.md`, `docs/progress.md`, `openclaw-operator-api-spec.md`, `openclaw-safe-mode-runbook.md`, `.env.example`.
- **Решения:** close — quantity → 0 + audit; OpenClaw проксирует на portfolio; safe mode — Redis при `REDIS_URL` / `OPENCLAW_SAFE_MODE_REDIS_URL`; PRIO-P2-PROMO — persisted `quality_*` + worker; PRIO-P2-RECAL — JSONL → aggregates → proposed JSON.
- **Локально:** `npm run build` (persistence, openclaw-gateway, portfolio, paper, web); `npm run test -w @arbibot/openclaw-gateway`.
- **Открыто:** полный прогон `ci:e2e-phase4-tier-routing` / `ci:bus-smoke` с Docker на машине разработчика; `db:migrate` **030/031** на стендах.

---

## 2026-04-20 — Phase 5 OpenClaw: мутации, UI, bus seed + закрытие сессии

**Дата:** 2026-04-20

### /compact — Focus: изменённые файлы, принятые решения, открытые вопросы

**Изменённые файлы (область):** `apps/openclaw-gateway` (v0.2.0: `OpenclawMutationController`/`Service`, rate limit, `IncidentBriefsService`, `SafeModeService`, DTO, upstream `postJson`/`patchJson`, unit tests); `apps/web` (BFF `POST`/`PATCH` для `openclaw/v1`, `mergeOperatorIntoBody`, `OpenclawWorkspace`, `SafeModeBanner`, layout, query keys, типы); `packages/outbox-kafka-bridge` (`consume.ts` — предупреждение при неизвестном `eventName`); `execution-orchestrator` (`http-venue.adapter.ts` — уточнение таксономии 4xx); `tools/seed-outbox-events.mjs`, `venue-load-test.mjs`, `ci-bus-smoke.sh`; корневой `package.json`; документы (`ci-verification-checklist`, `e2e-scenarios`, `intake-degradation-runbook`, `openclaw-ui-design`, `openclaw-safe-mode-runbook`, правки spec/observability/AGENTS/TODO/DEVELOPMENT_PLAN/progress); `.env.example`.

**Принятые решения:**

1. **Мутации OpenClaw:** прокси к execution / reconciliation + audit; **BFF** — один catch-all `[[...path]]` для `POST`/`PATCH`, тело JSON с merge `operatorId` из сессии оператора.
2. **Close position:** **501 Not Implemented** до появления API в **portfolio-service**.
3. **Safe mode:** состояние в памяти процесса gateway + audit; баннер в operator layout и панель на `/openclaw`.
4. **Bus-smoke:** опционально `SEED_OUTBOX=1` + `DATABASE_URL` запускает `seed-outbox-events.mjs` в `ci-bus-smoke.sh`.
5. **`DEVELOPMENT_PLAN`:** `P5-5-OAPI`, `P5-5-OCUI`, `P5-5-BRIEF` → `done` (зафиксировано в плане).

**Открытые вопросы:** зелёный CI на `main`/PR после пуша; shared store для safe mode при N репликах; portfolio `close`; полный publish/consume с реальными `outbox_events` вне минимального CI.

**Следующие шаги:** следить за CI; при необходимости локально `ci:e2e-phase4-tier-routing` / `ci:bus-smoke`; продуктовый backlog — close position, распределённый safe mode, формальный review.

---

## 2026-04-20 — Phase 5 OpenClaw gateway + bus-smoke (Windows) + закрытие сессии

**Дата:** 2026-04-20

---

## /compact — Focus: изменённые файлы, принятые решения, открытые вопросы

### Изменённые файлы

| Область | Файлы |
|--------|--------|
| **openclaw-gateway** | `src/openclaw/openclaw-env.ts`, `openclaw-upstream.service.ts`, `openclaw-auth.guard.ts`, `openclaw-auth.guard.spec.ts`, `openclaw.controller.ts`, `openclaw.module.ts`; `src/app.module.ts`; `src/health/health.controller.ts`; `src/main.ts` (без логики, при необходимости); `package.json` (0.1.0, Jest); `README.md` |
| **apps/web** | `app/(operator)/openclaw/page.tsx`; `app/api/operator/openclaw/v1/[[...path]]/route.ts`; `lib/openclaw-bff.ts`, `lib/openclaw-types.ts`; `components/degraded-status-banner.tsx` (тип `ReactNode`, первая загрузка через `queueMicrotask`) |
| **Документация / конфиг** | `docs/openclaw-gateway-runbook.md`, `docs/openclaw-operator-api-spec.md`, `docs/TODO.md`, `docs/progress.md`, `AGENTS.md`, `.env.example`, `.cursor/plans/DEVELOPMENT_PLAN.md` (`P5-5-GW` → `done`) |
| **Инструменты** | `tools/ci-bus-smoke.sh` (комментарий Windows/WSL + PowerShell) |

### Принятые решения

1. **OpenClaw gateway (`P5-5-GW`):** только **read** к execution / portfolio / reconciliation и read-through к operator BFF `dashboard/summary`; аутентификация **`x-openclaw-api-key`** по списку **`OPENCLAW_API_KEYS`**; корреляция — форвард **`x-correlation-id`** в upstream `fetch`; пагинация планов — поверх списка execution (`limit`/`cursor`), upstream сам капает выборку.
2. **Web BFF:** **`GET /api/operator/openclaw/v1/*`** проксирует на gateway с серверными **`OPENCLAW_GATEWAY_URL`** и **`OPENCLAW_BFF_API_KEY`** (секрет не в браузере).
3. **`npm run ci:bus-smoke` на Windows:** скрипт идёт через **bash**; если это WSL без `docker.sock`, **docker compose** падает. Решение: **Docker Desktop WSL integration** или тот же порядок шагов из **PowerShell** (описано в `ci-bus-smoke.sh` и `docs/TODO.md`); локальный эквивалент smoke при поднятом Docker Desktop проверен из PowerShell (**успех**).
4. **DegradedStatusBanner:** возврат **`ReactNode`**, первая poller-загрузка через **`queueMicrotask`**, чтобы убрать предупреждение ESLint про setState в effect.

### Открытые вопросы

- Зелёный прогон всех CI jobs на **PR/main** после пуша (включая `e2e-phase4-tier-routing`, `bus-smoke`).
- Полный сценарий **bus:publish → consume** с реальными строками **`outbox_events`** — вне минимального `ci-bus-smoke`, по [`docs/outbox-inbox.md`](docs/outbox-inbox.md).
- **Phase 5 дальше:** `P5-5-OAPI` (мутации + approval), `P5-5-OCUI` (полноценный UI) — не в этой сессии.

### Следующие шаги

- Следить за CI на PR; при сбое bus-smoke — проверить окружение shell vs Docker (см. выше).
- Реализация **`P5-5-OAPI`** / расширение **`P5-5-OCUI`** по `.cursor/plans/DEVELOPMENT_PLAN.md`.

---

## 2026-04-21 — Краткосрочный план Phase 4 (seed, e2e, CI) + закрытие сессии

**Дата:** 2026-04-21

---

## /compact — Focus

### Изменённые файлы

| Область | Файлы |
|--------|--------|
| **Миграции** | `infra/postgres/migrations/029_intake_policy_seed.sql` |
| **Инструменты** | `tools/seed-intake-policy-config.mjs`, `tools/e2e-phase4-tier-routing.mjs`, `tools/ci-e2e-phase4-tier-routing.sh`, `tools/ci-bus-smoke.sh` |
| **Корень** | `package.json` (скрипты `e2e:phase4-tier-routing`, `ci:e2e-phase4-tier-routing`, `seed:intake-policy-config`, `ci:bus-smoke`) |
| **CI** | `.github/workflows/ci.yml` (jobs `e2e-phase4-tier-routing`, `bus-smoke`) |
| **Документация** | `docs/intake-policy-config-keys.md`, `docs/TODO.md`, `docs/progress.md`, `docs/phase2-risk-policy-roadmap.md`, `AGENTS.md`, `.cursor/plans/DEVELOPMENT_PLAN.md` (`P4-4-TIER`, `P4-4-UI`, шаг `P4-4-TIER-ROUTING-E2E`) |

### Принятые решения

1. **JSON intake** в БД и в коде согласованы с [`policy-types.ts`](apps/market-intake-service/src/policy/policy-types.ts): `intake.routing.tiers` — объекты `hot` / `warm` / `cold` с `enabled` + `instrumentKeys`, а не массив `tiers` из черновика плана.
2. **Сид:** миграция `029` даёт дефолты без audit; HTTP-скрипт `seed-intake-policy-config.mjs` — для стендов; в CI config-service стартует с **`AUDIT_CLIENT_ENABLED=false`**, чтобы POST/PUT не блокировались отсутствием audit.
3. **E2E Phase 4:** проверка `GET /health/degradation` по полям `fallbackMode` / `intakeThrottlingEnabled` (не `degraded`); warm tier — два ingest подряд → **429** + `throttled: true`.
4. **bus-smoke в CI:** сборка bridge + опциональный Docker `--profile bus`; полный `bus:publish`/`consume` с реальными строками `outbox_events` остаётся ручным/стендовым.

### Открытые вопросы

- Зелёный прогон jobs **`e2e-phase4-tier-routing`** и **`bus-smoke`** на `main`/PR после мержа.
- Полный end-to-end bus (`outbox_events` → Kafka) — по [`docs/outbox-inbox.md`](docs/outbox-inbox.md), вне минимального CI job.
- `PRIO-P2-PROMO` / `PRIO-P2-RECAL` / `P5-5-*` в `DEVELOPMENT_PLAN.md` — перевод статусов по формальному review, не в этой сессии.

### Следующие шаги

- Мониторинг CI; при сбое — логи `/tmp/arbibot-e2e-phase4-*.log` в `ci-e2e-phase4-tier-routing.sh`.
- Опционально: секция intake в `/settings` UI (если продуктово нужно отображать ключи поверх BFF).

---

## 2026-04-20 — Обновление документации (AGENTS.md, session_summary.md)

**Дата:** 2026-04-20

---

## /compact — Focus

### Изменённые файлы

|| Область | Файлы |
||--------|--------|
|| **Документация** | `AGENTS.md` (Phase 4 prep, BFF routes, CI, Frontend docs), `session_summary.md` (этот файл) |

### Принятые решения

1. **AGENTS.md обновлён** до статуса на 2026-04-20: добавлены Phase 4 prep (market-intake throttling, degraded UI signals, P2 prep, OpenClaw skeleton), обновлён раздел BFF routes, добавлен `e2e-phase4-tier-routing` в CI section, обновлён список Frontend documentation.
2. **session_summary.md обновлён** с сохранением истории предыдущей сессии (Phase 4 prep implementation).

### Открытые вопросы

- Нет открытых вопросов в рамках обновления документации.

### Следующие шаги

- По запросу пользователя: начать работу над задачами из TODO.md / DEVELOPMENT_PLAN.md.
- При необходимости: обновить `DEVELOPMENT_PLAN.md` для `PRIO-P2-PROMO`, `PRIO-P2-RECAL`, `P5-5-GW`, `P5-5-OAPI`.

---

# Session Summary: Phase 4 prep — CI, observability, docs

**Дата:** 2026-04-20

---

## /compact — Focus

### Изменённые файлы

|| Область | Файлы |
||--------|--------|
|| **CI / E2E** | `tools/ci-e2e-phase2-watchlist-route-scoring.sh` (new); [`package.json`](package.json) (`ci:e2e-phase2-watchlist-route-scoring`, `export:route-scoring-history`); [`.github/workflows/ci.yml`](.github/workflows/ci.yml) (job `e2e-phase2-watchlist-route-scoring`) |
|| **`apps/web`** | [`app/api/operator/settings/watchlist-tiers/route.ts`](apps/web/app/api/operator/settings/watchlist-tiers/route.ts); [`components/settings-workspace.tsx`](apps/web/components/settings-workspace.tsx) (блок watchlist tiers + парсинг `{ items }` для route scoring) |
|| **Grafana** | [`infra/grafana/dashboards/arbibot-risk-policy-writers.json`](infra/grafana/dashboards/arbibot-risk-policy-writers.json); [`infra/grafana/README.md`](infra/grafana/README.md) |
|| **Инструменты** | [`tools/export-route-scoring-history.mjs`](tools/export-route-scoring-history.mjs) |
|| **Документация** | [`docs/phase4-prep-bridge.md`](docs/phase4-prep-bridge.md), [`docs/adr-phase4-intake-throttling.md`](docs/adr-phase4-intake-throttling.md), [`docs/phase4-ui-degraded-signals.md`](docs/phase4-ui-degraded-signals.md); правки [`docs/phase2-risk-policy-roadmap.md`](docs/phase2-risk-policy-roadmap.md), [`docs/TODO.md`](docs/TODO.md), [`AGENTS.md`](AGENTS.md); append [`docs/progress.md`](docs/progress.md), этот файл |

### Принятые решения

1. **CI вместо только ручного gate:** добавлен отдельный job и bash-wrapper по аналогии с `ci-e2e-phase3` — только Postgres + **risk-service** + токен `RISK_POLICY_JOB_TRIGGER_TOKEN` (дефолт в скрипте для CI).
2. **Операторская видимость tiers:** read-only через существующий risk API — BFF прокси без дублирования логики в других сервисах; таблица на `/settings` рядом с route scoring history.
3. **Grafana:** один JSON-дашборд в репо с rates счётчиков writers и quantiles по `arb_route_scoring_score_distribution_bucket`.
4. **Replay без CH:** экспорт `route_scoring_history` в stdout (JSONL/CSV), параметры периода и опционально `ROUTE_KEY` через env.
5. **Phase 4 границы:** single-writer таблиц — **risk-service**; intake в ADR — только read/cache политики, fallback при сбое risk/config.

### Открытые вопросы

- **Локальный полный E2E bash-цикл** на машине без Docker Postgres в этой сессии не прогонялся; валидация — CI job + локальные lint/test web/risk/contracts.
- **Migration 020 / full bus-smoke** — вне скоупа; остаются в [`docs/TODO.md`](docs/TODO.md).

### Следующие шаги

- Убедиться, что job **`e2e-phase2-watchlist-route-scoring`** зелёный на `main`/PR.
- По продукту: реализация throttling в **market-intake** по ADR; опционально BFF «health policy writers» для UI без Grafana.

---

# Session Summary: Phase 2.2 writers — quality gate & handoff

**Дата:** 2026-04-19

---

## /compact — Focus

### Изменённые файлы

|| Область | Файлы |
||--------|--------|
|| **Тесты (`@arbibot/risk-service`)** | `apps/risk-service/src/policy/watchlist-tiering-writer.service.spec.ts`, `route-scoring-writer.service.spec.ts`, `policy-jobs.service.spec.ts` |
|| **E2E** | `tools/e2e-phase2-watchlist-route-scoring.mjs` |
|| **Документация** | `docs/progress.md` (append), `docs/TODO.md` (строка актуализации), `session_summary.md` (этот файл) |

### Принятые решения

1. **`@typescript-eslint/unbound-method` в Jest:** не передавать в `expect(...)` методы сомокастных объектов (`watchlist.recordSnapshot`, `scoring.append`, `audit.record`, `watchlistWriter.runCycle`). Вместо этого — локальные `const fn = jest.fn()`, внедрение в мок-объект и ассерты на `fn`.
2. **E2E-скрипт:** финальный `console.log` без `eslint-disable` — скрипт не в eslint scope пакета risk-service, комментарий был лишним.
3. **Верификация перед handoff:** `npm run lint -w @arbibot/risk-service`, полный `npm run test -w @arbibot/risk-service`, `npm run build -w @arbibot/contracts` — все успешны.

### Открытые вопросы

- **E2E Phase 2.2:** в этой сессии не запускался полный `npm run e2e:phase2-watchlist-route-scoring` против живого стека (нужны `DATABASE_URL`, поднятый risk-service, согласованный `RISK_POLICY_JOB_TRIGGER_TOKEN` на клиенте и сервере).
- **CI:** нет обязательной job в pipeline для нового E2E (по плану — опционально).
- **Migration 020:** по-прежнему отдельный backlog (`020_policy_configuration_scopes.sql`).

### Следующие шаги

- Прогнать E2E локально или в CI-обёртке при готовности инфраструктуры.
- Продолжить Phase 4 / roadmap по аналитике tiers и scores приоритетами продукта.

---

# Session Summary: AGENTS.md update + bus-smoke verification

**Дата:** 2026-04-19

---

## /compact — Focus

### Изменённые файлы

|| Область | Файлы |
||--------|--------|
|| **документация** | `AGENTS.md` (update), `docs/progress.md` (append), `session_summary.md` (этот файл) |
|| **outbox-kafka-bridge** | сборка для runtime verification |

### Принятые решения

1. **AGENTS.md update:** добавлена информация о последней сессии (review gate закрыт, Monorepo ESLint исправлен, bug fix в `PaperDiscoveryService.runDiscoveryCycle`, worker improvements)
2. **Bus-smoke — static verification:** код `outbox-kafka-bridge` проверен на соответствие документации в `docs/outbox-inbox.md` (entrypoints, event_type filter, smoke-consumer logging)
3. **Bus-smoke — runtime verification:** запущен Redpanda (порт 19092), publisher и consumer успешно подключены к Kafka
4. **Full E2E отложен:** для полной проверки с сообщениями в топике требуются запущенные сервисы с сгенерированными outbox_events (future task, connection test достаточен)

**Проверки качества:**
- Lint: SUCCESS — AGENTS.md и progress.md без ошибок
- Build: SUCCESS — outbox-kafka-bridge собран
- Docker compose: SUCCESS — Redpanda запущен и остановлен
- Runtime: SUCCESS — publisher и consumer подключены к Kafka

### Открытые вопросы

- **Migration 020:** SQL ошибки в `020_policy_configuration_scopes.sql` (не связанный с bus-smoke, отдельный issue для будущего fix)
- **Full E2E bus-smoke:** при изменениях в outbox-kafka-bridge или event types требуется full end-to-end проверка с запущенными сервисами

### Следующие шаги

- При необходимости — запустить full bus-smoke (docker compose + сервисы + E2E + publisher + consumer)
- При необходимости — fix migration 020 (отдельная задача)
- Продолжить backlog по Phase 2.2 / operator API по плану

---

# Session Summary: Phase 2.2 slice, миграции, `db:migrate`, артефакты

**Дата:** 2026-04-19

---

## /compact — Focus

**Изменённые файлы (ключевые):**
- `infra/postgres/migrations/020_policy_configuration_scopes.sql`, `024_fix_rollback_configuration_function.sql`, `028_paper_drift_route_key.sql`
- `apps/config-service/src/config/configurations.service.ts` (вызов `rollback_configuration`)
- `apps/paper-trading-service/src/paper/paper.module.ts`, `paper-drift.service.ts`, `dto/create-drift-sample.dto.ts`, `packages/persistence/src/paper-drift-sample.entity.ts`
- `apps/risk-service/package.json` (jest из корневого `node_modules` на Windows)
- `apps/web/app/api/operator/settings/route-scoring/[routeKey]/route.ts`, `apps/web/components/settings-workspace.tsx`
- `docs/observability-tracing.md`, `docs/paper-promotion-criteria.md`, `docs/services.md`, `AGENTS.md`, `docs/TODO.md`, `.cursor/plans/DEVELOPMENT_PLAN.md`, `docs/progress.md`

**Принятые решения:**
1. **`020` идемпотентность:** `CREATE TYPE` в `DO … EXCEPTION WHEN duplicate_object`; смена уникальности — `ALTER TABLE … DROP CONSTRAINT IF EXISTS policy_configurations_key_version_unique` затем `DROP INDEX IF EXISTS`, затем `CREATE UNIQUE INDEX IF NOT EXISTS …`.
2. **`rollback_configuration`:** в PostgreSQL нельзя оставлять обязательный параметр после параметров с `DEFAULT` — порядок: `(p_config_key, p_to_version, p_operator_id, p_scope_type DEFAULT …, p_scope_value DEFAULT …)`; вызов из сервиса: `[configKey, toVersion, operatorId, scopeType, scopeValue]`.
3. **`028` и дрифт:** колонка `route_key` в `paper_drift_samples` + опциональное поле в DTO; импорты discovery из `src/paper-discovery/` через `../paper-discovery/`.
4. **`db:migrate`:** локально подтверждены запись `028_paper_drift_route_key.sql` в `schema_migrations` и наличие `route_key` в таблице.
5. **Тесты risk-service:** скрипт `node ../../node_modules/jest/bin/jest.js`, если локальный `node_modules/jest` отсутствует.

**Открытые вопросы:**
- Прогон миграций и проверка `028` на **вашем** staging (нужен свой `DATABASE_URL`).
- Заполнение watchlist / route scoring — пока read API и таблицы; writer-пайплайн в backlog (`docs/TODO.md`).
- Сопоставление idempotency adaptive risk со строкой `reasons` — при смене текста префикса возможна хрупкость (улучшение: явный флаг в схеме хранения).

**Следующие шаги:** `npm run db:migrate` на staging; SQL-проверка `schema_migrations` + `information_schema.columns` для `route_key`; приоритизация writer jobs для tier/score; при необходимости полный `lint`/`build` монорепо.
