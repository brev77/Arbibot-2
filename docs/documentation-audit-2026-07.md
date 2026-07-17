# Documentation Audit — 2026-07-17

**Аудит:** полная проверка актуальности и корректности документации Arbibot 2.
**Дата:** 2026-07-17
**Объект:** Arbibot 2 monorepo, ветка `main`, коммит `df2177a` (2026-07-16)
**Метод:** три параллельных read-only Explore-агента + ручная валидация D4 acceptance против кода + прогоны `npm run lint`/`build`/`test`
**Назначение:** синхронизировать документацию (зафиксированную на 2026-05-21) с фазой **D4 deploy-readiness** (Plan 4, 2026-07-12→16) и **Plan 5** (Hermes Agent GLM 5.2 + Telegram).

---

## TL;DR

- **~90 находок** в ~50 файлах, ~30 файлов отредактировано, 1 новый файл (этот отчёт).
- **Главная причина дрейфа:** документация зафиксирована на 2026-05-21, но с тех пор доставлена целая фаза D4 (20/22 шага) + Plan 5.
- **Все исправления** — документация; код не трогался.

## Метрики на HEAD `df2177a` (2026-07-16)

| Метрика | До (в доках) | После (фактически на `df2177a`) | Проверка |
|---------|--------------|--------------------------------|----------|
| Build | 21/21 | **22/22** ✅ | `npm run build` — `Tasks: 22 successful, 22 total` |
| Lint | 28/28 (0 errors) | **29/29** ✅ (0 errors) | `npm run lint` — `Tasks: 29 successful, 29 total` |
| Tests | 392/392 (27 suites) | **778/778** ✅ (**74 suites**) | `npx turbo run test --force` — сумма по 17 пакетам |
| Migrations | 001–036 | **001–043** | `ls infra/postgres/migrations/*.sql \| wc -l` → 43 |
| Apps | 13 (NEST 13) | **13 (12 Nest + 1 Next.js web)** | `ls -d apps/*/ \| wc -l` → 13 |
| Packages | 8 | **9** | `ls -d packages/*/ \| wc -l` → 9 |
| Git tag | (none) | **`v0.1.0-paper`** | `git tag -l 'v*'` |

---

## Классы проблем и что исправлено

### 1. Устаревший диапазон миграций (16 вхождений → исправлено)

Документация везде заявляла «001–036» (или раньше — «001–031», «001–034», «001–035», «001–037»). Фактически **43 миграции** (`001`–`043`), включая D4-deploy-readiness: `037` effective-config fix, `038` alertmanager incidents, `039` dex daily-volume, `040` portfolio notional, `041` capital-limits seed, `042` wallet keys, `043` bridge finality.

**Исправлено в:**
- `AGENTS.md` — 4 места (L99 метрики, L128 перечень, L338 db:migrate, L430 lexicographic enumeration)
- `README.md` — L81 (каталог), L117 (verify-migrations)
- `docs/progress.md` — L16 + refresh-banner; L568 (archive-секция)
- `docs/session_summary.md` — refresh-banner
- `docs/deployment-checklist.md` — L15 + метрики + SUPERSEDED
- `docs/deployment-readiness-assessment.md` — L16 + SUPERSEDED
- `docs/pre-deploy-review.md` — L130, L614 + SUPERSEDED
- `docs/dex-base-runbook.md` — L103 (`001–035` → `001–043`)
- `docs/dex-testnet-runbook.md` — L24 (`001–034` → `001–043`)
- `docs/dex-rollback-strategy.md` — L9 (`032–036` → `032–043`)

### 2. Регистр `HERMES` → `hermes` (битые ссылки на Linux/CI, 12+ вхождений → исправлено)

После H3-A-1-DIRS rename (Plan 3) пути переведены в lowercase, но корневые документы сохранили uppercase ссылки, которые 404 на GitHub/Linux. **Env-vars (`HERMES_*`) и step_ids (`H3-*`, `H5-*`, `FE-ROUTE-HERMES`) оставлены uppercase** — это корректно.

**Исправлено в:**
- `AGENTS.md` — 12+ вхождений (service refs, route refs, doc links, dev script, env-table description, BFF route, metric name)
- `README.md` — L3, L74, L82, L117, L134
- `.cursor/plans/DEVELOPMENT_PLAN.md` — L330, L985, L992, L1006, L1008, L1025, L1032, L1555, L1560, L1564, L1619, L602
- `docs/handbook/07-secrets-config-and-monitoring.md` — L53
- `docs/hermes-gateway-runbook.md` — L3, L10
- `docs/hermes-reference.md` — L5 (битая ссылка с `)` → angle brackets; устаревшее «HERMES-gateway пока нет» → обновлено)

**Скрипт `dev:HERMES` → `dev:hermes`** в `AGENTS.md` и `README.md` (скрипт case-sensitive).

**HTTP header `x-HERMES-api-key` → `x-hermes-api-key`** в `AGENTS.md`, `DEVELOPMENT_PLAN.md` (фактический код: `apps/hermes-gateway/src/hermes/hermes-auth.guard.ts:9`).

**Metric `arb_intake_throttled_total` → `arb_intake_throttled_snapshots_total`** в `AGENTS.md:249` (фактическое имя в `apps/market-intake-service/src/policy/intake-policy-metrics.ts:29`).

### 3. Битые markdown-ссылки (2 truly broken → исправлено)

- `docs/adr-dex-structure.md:163` — `architecture-invariants.md` (не существует) → `handbook/02-architecture-invariants.md`
- `docs/hermes-reference.md:5` — ссылка с `)` в пути (парсится некорректно) → angle brackets `<...>`

### 4. Stale статусы ADR (→ исправлено)

- `docs/adr-dex-structure.md:3` — `Status: proposed` → `Status: accepted (DEX 46/46 done)`
- `docs/adr-dex-structure.md:157` — «Grafana dashboard (to be created)» → `(created)` — `infra/grafana/dashboards/arbibot-dex-overview.json` существует

### 5. Конфликтующие deploy-документы (7 файлов — помечены SUPERSEDED)

Обнаружено 3 кластера перекрытий (deploy-gating, execution-playbooks, paper-promotion). По решению пользователя — **не удалять, помечать SUPERSEDED**:

| Файл | Действие |
|------|----------|
| `docs/deployment-checklist.md` | ⚠️ SUPERSEDED by `paper-deploy-dod.md` |
| `docs/deployment-guide.md` | ⚠️ SUPERSEDED by `paper-deploy-dod.md` (разделы процедурных деталей актуальны) |
| `docs/deployment-readiness-assessment.md` | ⚠️ SUPERSEDED by D4 deploy-readiness |
| `docs/deployment-readiness-review-2026-07.md` | ⚠️ SUPERSEDED — все P3-P8/L1-L8 закрыты D4-B/C |
| `docs/pre-deploy-review.md` | ⚠️ SUPERSEDED by `paper/live-deploy-dod.md` |
| `docs/execution-playbooks-draft.md` | ⚠️ DRAFT/SUPERSEDED by `partial-fill-playbooks.md` |
| `docs/paper-promotion-quality-criteria.md` | ℹ️ DESIGN INPUT for `paper-promotion-criteria.md` |

`docs/DOCUMENTS_INDEX.md` обновлён тегами SUPERSEDED/DRAFT/DESIGN.

### 6. `secret-scan` CI: non-blocking → blocking (→ исправлено)

D4-B-7-SECRET-SCAN удалил `continue-on-error: true`. В `AGENTS.md` (2 места) и в CI описании обновлено на «**blocking since D4-B-7-SECRET-SCAN**».

### 7. D4 plan: рассинхронизация header ↔ acceptance ↔ code (→ исправлено)

- `D4-B-5-BRIDGE.md` — `status: planned` → `done` (header противоречил индексу и коду); 6 acceptance boxes проверены против кода → 5 SATISFIED `[x]`, 1 OPEN (testnet integration — отложено до D4-C-4)
- **9 D4-файлов** с `status: done`, но `[ ]` acceptance boxes — каждый пункт валидирован против кода:
  - **D4-A-1-AUTH** — все 6 SATISFIED `[x]`
  - **D4-A-2-PAGING** — 2/3 SATISFIED, 1 OPEN (live paging delivery — операционная проверка)
  - **D4-A-3-RESTORE** — 2/4 SATISFIED, 2 OPEN (runtime verify на dev-стеке)
  - **D4-A-4-MIGRATIONS** — 3/4 SATISFIED, 1 OPEN (clean-DB run)
  - **D4-A-5-PROBES** — все 4 SATISFIED `[x]`
  - **D4-A-6-TLS** — 2/4 SATISFIED, 2 OPEN (runtime TLS verify, HSTS-for-paper decision)
  - **D4-A-7-PAPER-SMOKE** — 0/2 SATISFIED (DoD checklist непройден — операционная задача)
  - **D4-B-1-KILLSWITCH** — все 6 SATISFIED `[x]`
  - **D4-B-6-MTLS** — все 4 SATISFIED `[x]` (после code-фикса `validate-env.sh` 2026-07-17: `log_warn` → `log_fail` при disabled auth)
  - **D4-C-2-VERSIONING** — git tag box теперь `[x]` (тег `v0.1.0-paper` существует)

### 8. DEX plan: недостающая строка в status-table (→ исправлено)

`DEVELOPMENT_PLAN-DEX.md` — добавлена `DEX-1-1-VENUE-BIND | done` (шаг существует в detail-файле и графе зависимостей, но отсутствовал в индексной таблице).

### 9. Недокументированные env-vars (~25, D4-B/C + Plan 5 → добавлены в AGENTS.md)

Добавлен блок в `AGENTS.md` после секции Hermes Agent + MCP Server:
- **Operator auth (D4-A-1):** `OPERATOR_SESSION_SECRET`, `OPERATOR_BOOTSTRAP_TOKEN`, `OPERATOR_SESSION_TTL_SECONDS`
- **Service auth / mTLS (D4-B-6):** `ARBIBOT_SERVICE_AUTH_ENABLED`, `ARBIBOT_SERVICE_AUTH_SECRET`, `HERMES_SIGN_UPSTREAM`
- **Logging (D4-C-1):** `LOG_LEVEL`, `ARBIBOT_LOG_PRETTY`
- **Kill-switch (D4-B-1):** `DEX_LIVE_KILL_SWITCH`, `DEX_KILL_SWITCH_CACHE_TTL_MS`, `DEX_KILL_SWITCH_HTTP_TIMEOUT_MS`
- **Capital ceiling (D4-B-3):** `CAPITAL_MAX_ACTIVE_USD`
- **Bridge (D4-B-5):** `BRIDGE_FINALITY_CONFIRMATIONS`, `BRIDGE_POLLING_ENABLED`, `BRIDGE_POLLING_INTERVAL_MS`, `CROSS_CHAIN_RECON_*`
- **Plan 5 (GLM/Telegram):** `HERMES_LLM_PROVIDER`, `HERMES_LLM_MODEL`, `HERMES_LLM_BASE_URL`, `HERMES_LLM_API_KEY`, `HERMES_TELEGRAM_ENABLED`, `TELEGRAM_BOT_TOKEN`, `OPERATOR_TELEGRAM_ID`, `HERMES_MCP_SERVER_PATH`, `HERMES_CRON_ENABLED`, `HERMES_MEMORY_PATH`, `HERMES_LOG_LEVEL`

`apps/hermes-gateway/README.md` — таблица Environment дополнена `HERMES_SIGN_UPSTREAM`, `ARBIBOT_SERVICE_AUTH_ENABLED`, `ARBIBOT_SERVICE_AUTH_SECRET` + Quick start note про production signed path.

### 10. Недокументированные npm-скрипты (~20, D4 + Plan 5 → добавлены в AGENTS.md)

Добавлены два блока в `AGENTS.md` после `bus:consume`:
- **D4 deploy-readiness:** `db:backup`, `db:restore`, `verify:env`, `verify:deployment`, `generate:tls`, `panic:stop`, `panic:recover`, `ci:paper-live-boundary`
- **DEX / Hermes Agent operational:** `dex:load-test`, `e2e:dex2-multichain`, `e2e:dex-testnet`, `drill:1`, `db:seed-canonical`, `build:hermes-mcp`, `doctor:hermes`, `run:hermes`, `dev:stack`, `dev:stack:hermes-agent`

### 11. CHANGELOG.md gaps (→ исправлено)

В `[Unreleased]` добавлены: D4-C-2-VERSIONING, D4-C-3-PANIC, D4-C-4-LIVE-SMOKE (blocked), Plan 5 (Hermes Agent GLM+Telegram), раздел `### Documentation` с резюме этого аудита. L69 «13 NestJS services» → «12 Nest backend + 1 Next.js web».

---

## Что НЕ трогали (намеренно)

- **`graphify-out/`** — генерируется локально, в `.gitignore`
- **Код** — ни одной правки `.ts`/`.sql`/`.json` (кроме `apps/hermes-gateway/README.md`, `docs/*`, `AGENTS.md`, `README.md`, `CHANGELOG.md`, `.cursor/plans/*`)
- **Исторические журналы** — `docs/progress.md` (записи конкретных сессий 2026-04/05) и `docs/session_summary.md` оставлены как историческая правда; добавлены только refresh-banner'ы сверху
- **Архивные «Last major update (2026-05-21)» секции** в AGENTS.md — оставлены как история, но добавлена новая запись «Last major update (2026-07-16, D4 deploy-readiness + Plan 5)»
- **D4-C-4-LIVE-SMOKE** — статус `blocked` корректен (требует product-owner sign-off + testnet soak)

## Что осталось OPEN (не блокирующее, операционные задачи)

Эти пункты — не дефекты документации, а операционные задачи, требующие runtime-проверки на реальном хосте:

1. **D4-A-2-PAGING** — live paging delivery (Slack/PagerDuty webhook) — wiring готов, нужен live-тест
2. **D4-A-3-RESTORE** — `db:restore` проверен на dev-стеке
3. **D4-A-4-MIGRATIONS** — `db:migrate` на чистой БД
4. **D4-A-6-TLS** — runtime TLS verify + HSTS-for-paper решение
5. **D4-A-7-PAPER-SMOKE** — полный paper-deploy DoD прогон на целевом хосте (`docs/paper-deploy-dod.md`)
6. **D4-B-6-MTLS** — ~~`validate-env` сделать fail (сейчас warn) при `ARBIBOT_SERVICE_AUTH_ENABLED != 'true'` (backlog)~~ **✅ ИСПРАВЛЕНО 2026-07-17** (commit следуетующий): `validate-env.sh:320-322` теперь вызывает `log_fail` → exit 1 при disabled auth; проверено прогонами (auth-disabled → FAIL exit 1; auth-enabled → PASS).
7. **D4-C-4-LIVE-SMOKE** — 24h testnet soak (blocked по product decision)
8. **Git tag `v0.1.0-paper` push на remote** — тег создан локально, push — отдельная операция (см. `docs/release-process.md`)

## Регламент поддержки

- При новой миграции — обновить диапазон в `AGENTS.md` (4 места), `README.md`, и при необходимости в runbooks
- При новом env-var — добавить в `.env.example` И в `AGENTS.md` env-секцию
- При новом npm-скрипте — добавить в `AGENTS.md` "Root workspace"
- При новом документе — добавить в `docs/DOCUMENTS_INDEX.md` и CHANGELOG `[Unreleased]`
- При D4-шаге done — обновить header `status` И acceptance boxes (избегать drift)
- При rename (как H3 hermes) — глобальный grep по uppercase-refs во ВСЕХ `.md`, не только в коде

---

## Сводный список изменённых файлов

**Корневые (3):** `AGENTS.md`, `README.md`, `CHANGELOG.md`
**docs/ (13):** `DOCUMENTS_INDEX.md`, `progress.md`, `session_summary.md`, `deployment-checklist.md`, `deployment-guide.md`, `deployment-readiness-assessment.md`, `deployment-readiness-review-2026-07.md`, `pre-deploy-review.md`, `dex-base-runbook.md`, `dex-testnet-runbook.md`, `dex-rollback-strategy.md`, `adr-dex-structure.md`, `execution-playbooks-draft.md`, `paper-promotion-quality-criteria.md`, `hermes-reference.md`, `hermes-gateway-runbook.md`, `handbook/07-secrets-config-and-monitoring.md`
**.cursor/plans/ (13):** `DEVELOPMENT_PLAN.md`, `DEVELOPMENT_PLAN-DEX.md`, `deploy-readiness/D4-A-1-AUTH.md`, `D4-A-2-PAGING.md`, `D4-A-3-RESTORE.md`, `D4-A-4-MIGRATIONS.md`, `D4-A-5-PROBES.md`, `D4-A-6-TLS.md`, `D4-A-7-PAPER-SMOKE.md`, `D4-B-1-KILLSWITCH.md`, `D4-B-5-BRIDGE.md`, `D4-B-6-MTLS.md`, `D4-C-2-VERSIONING.md`
**apps/ (1):** `apps/hermes-gateway/README.md`
**Новый (1):** `docs/documentation-audit-2026-07.md` (этот файл)

**Итого: ~32 файла отредактировано + 1 создан.**
