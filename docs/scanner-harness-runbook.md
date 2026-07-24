# Scanner Harness Runbook — процессы проверки разработки

> **Назначение:** единый справочник «как валидировать работу над scanner-service» на каждом этапе. Дополняет [`scanner-service-plan.md`](scanner-service-plan.md) (архитектура) и [`.cursor/plans/DEVELOPMENT_PLAN-SCANNER.md`](../.cursor/plans/DEVELOPMENT_PLAN-SCANNER.md) (step_ids) процедурной частью: build/lint/test/CI/e2e/verify команды, smoke-сценарии, рантайм-DoD.
> **Дата:** 2026-07-24. **Статус:** harness-документ, согласуется перед стартом разработки.

---

## 0. Принципы harness

1. **Static checks недостаточно.** Урок `docs/lessons/hermes-agent-dod-failure.md`: Plan 5 был помечен 7/7 done без запуска бинарника. Для scanner-service каждый шаг с runtime-поведением требует **runtime smoke** (реальный цикл, реальный RPC, реальный POST), а не только build+grep.
2. **Mirror существующих паттернов.** CI-скрипты (`ci-hermes-agent-smoke.sh`, `ci-paper-live-boundary.sh`), e2e-скрипты (`tools/e2e-phase3-paper-promotion.mjs`), review-gate (`review-gate-cfg3-paper-discovery.md`) — образцы. Не изобретать новые конвенции.
3. **Scoped validation** (git-workflow-agent): code → build/lint/test; config → `verify:env`; docs → none. Не гонять full monorepo test на каждый шаг.
4. **Runtime DoD обязателен** для Phase 1+ (как `H5-G-RUNTIME` для Hermes).

---

## 1. Локальная разработка (per-step)

### Базовые команды (выполнять из корня репо)

```bash
# Build одного пакета (scoped)
npm run build -w @arbibot/scanner-service
npm run build -w @arbibot/contracts        # после S0-1/S0-2
npm run build -w @arbibot/persistence      # после S0-3

# Lint одного пакета
npm run lint -w @arbibot/scanner-service

# Test одного пакета
npm run test -w @arbibot/scanner-service

# Dev-режим scanner-service
npm run dev:scanner                        # после S1-1

# Миграции (после S0-4)
npm run db:migrate
npm run db:verify-migrations               # проверяет 030, 031; для scanner — override list
node tools/verify-migrations-applied.mjs infra/postgres/migrations/<next>_scanner.sql
```

### Чеклист per-step (перед commit)

1. Затронутый пакет **builds** green.
2. Затронутый пакет **lints** 0 errors.
3. Новые/изменённые файлы покрыты **unit tests** (где уместно).
4. Если шаг runtime (worker, RPC, API) — **runtime smoke** выполнен локально (см. §3).
5. Статус шага обновлён в `DEVELOPMENT_PLAN-SCANNER.md` (`todo` → `in_progress` → `done`).
6. Commit через git-workflow-agent: structured commit, linked to step_id, direct-to-main.

---

## 2. Полный monorepo verify (перед milestone)

Выполнять перед переводом фазы в `done` или перед PR:

```bash
npm run build          # Turbo build (все 22+ пакета)
npm run lint           # Turbo lint (все пакеты)
npm run test           # Turbo test (все пакеты)
```

**Ожидаемые baseline (на коммите df2177a, 2026-07-16):** Build 22/22 ✅ | Lint 29/29 ✅ | Tests 778/778 ✅ (74 suites). После scanner-service: 23 пакета (build/lint), тесты +N.

---

## 3. Runtime smoke-сценарии (по фазам)

> Static checks = build + lint + unit test. Runtime smoke = реальный запуск с реальными зависимостями. Для Phase 1+ runtime обязателен.

### Phase 1 runtime smoke (после S1-7)

```bash
# 1. Старт scanner-service
npm run dev:scanner &
sleep 3

# 2. Health
curl -s http://127.0.0.1:3021/health | jq .
# Ожидается: { status: "ok", rpc: {...}, config: {...} }

# 3. Metrics
curl -s http://127.0.0.1:3021/metrics | grep arb_scanner_
# Ожидается: arb_scanner_cycles_total, arb_scanner_rpc_latency_ms, и т.д.

# 4. Status (instances из config join runtime)
curl -s http://127.0.0.1:3021/scanner/status | jq .

# 5. Force-refresh config
curl -s -X POST http://127.0.0.1:3021/scanner/instances/<id>/refresh-config | jq .

# 6. Manual trigger cycle
curl -s -X POST http://127.0.0.1:3021/scanner/instances/<id>/run | jq .
# Ожидается: findings созданы, instances обновлены
```

**Runtime DoD Phase 1 (по аналогии с H5-G-RUNTIME):**
- [ ] Сервис стартует без ошибок, порт 3021 слушается.
- [ ] `GET /health` → 200, показывает RPC + config статус.
- [ ] Worker крутит циклы (видно в логах + `arb_scanner_cycles_total` растёт).
- [ ] RPC read-only работает на whitelisted pools (real mainnet RPC, read-only — без wallet/key).
- [ ] Rate limiter не даёт 429 на публичных RPC.
- [ ] Config reload reconcile срабатывает при change в config-service (force-refresh или TTL).

### Phase 3 runtime smoke (после S3-2)

```bash
# 1. Старт scanner-service + opportunity-service
npm run dev:scanner &
npm run dev:opportunity &

# 2. Триггер цикла → finding → POST /opportunities
curl -s -X POST http://127.0.0.1:3021/scanner/instances/<id>/run | jq .

# 3. Проверить: opportunity создан
curl -s http://127.0.0.1:3010/opportunities | jq '.[] | select(.payload.source == "scanner")'

# 4. Проверить: scanner_findings.opportunity_id заполнен, publish_status=published
curl -s http://127.0.0.1:3021/scanner/findings | jq '.[] | {id, opportunity_id, publish_status}'

# 5. Degradation smoke: остановить opportunity-service, триггер → publish_status=failed
pm2 stop opportunity-service   # или kill
curl -s -X POST http://127.0.0.1:3021/scanner/instances/<id>/run
curl -s http://127.0.0.1:3021/scanner/findings | jq '.[] | select(.publish_status=="failed")'
# Ожидается: finding с publish_status=failed, publish_attempts=3, opportunity_id=null

# 6. Orphan worker: поднять opportunity-service → orphan re-publish
pm2 start opportunity-service
# дождаться orphan worker interval → publish_status=published
```

### Phase 3b runtime smoke (после S3-3)

```bash
# Проверить outbox OpportunityDetected после create()
POST http://127.0.0.1:3010/opportunities { payload: {...} }
# Затем в БД:
psql $DATABASE_URL -c "SELECT event_type, schema_version, source_module FROM outbox_events WHERE event_type='OpportunityDetected' ORDER BY created_at DESC LIMIT 5;"
# Ожидается: event_type=OpportunityDetected, schema_version=1, source_module=opportunity-service
```

---

## 4. CI harness (GitHub Actions)

### Новый job `scanner-smoke` (после S5-4)

По образцу `hermes-agent-smoke` job в `.github/workflows/ci.yml`. Скрипт `tools/ci-scanner-smoke.sh`:

**Что CI проверяет (без секретов):**
1. `apps/scanner-service` builds (`npm run build -w @arbibot/scanner-service`).
2. `SERVICE_IDS.scannerService` + `SCANNER_HTTP_ROUTES` присутствуют в `packages/contracts`.
3. `OpportunityDetectedPayloadV1` тип определён в `packages/contracts/src/events.ts`.
4. `ScannerInstanceStatusEntity` + `ScannerFindingEntity` зарегистрированы в `ARBIBOT_TYPEORM_ENTITIES`.
5. Миграция `<next>_scanner.sql` существует в `infra/postgres/migrations/`.
6. `scanner.*` zod-схемы присутствуют в `apps/web/lib/policy-config-registry.ts`.
7. (опц., если запущен) `GET /health` на 3021 → 200.

**Что CI НЕ проверяет (требует секреты/runtime — manual DoD):**
- Реальный RPC read (нужен `RPC_SCANNER_*_URL`).
- Реальный POST /opportunities round-trip (нужен opportunity-service).
- Реальные findings на mainnet pools.

> Эти сценарии покрываются runtime smoke §3 (manual DoD).

### Расширение `paper-live-boundary` job

`tools/ci-paper-live-boundary.sh` дополняется симметричными правилами:
- **PL.3-new:** `apps/scanner-service/src` НЕ импортирует paper-модули (`@arbibot/paper-trading-service`, `PaperCapitalService`, и т.д.).
- **PL.4-new:** `apps/paper-trading-service/src` НЕ импортирует `@arbibot/scanner-service` (paper остаётся изолированным).

### e2e stub (после S5-4)

`tools/e2e-scanner-smoke.mjs` (по образцу `tools/e2e-phase3-paper-promotion.mjs`):
- Старт scanner-service + opportunity-service.
- Триггер цикла → проверка finding + opportunity.
- Degradation smoke (stop opportunity → failed → restart → republish).

npm script: `npm run e2e:scanner-smoke`.

---

## 5. Architecture / security review (перед milestone)

### Skills (запускать перед `done` фазы)

- **architecture-guard-agent** — после Phase 0, 3, 5 (новые single-writer границы, outbox pattern).
- **backend-review-agent** — после Phase 1, 2, 3 (NestJS/Fastify, schema review, single-writer).
- **dex-security-and-capital-safety** — после Phase 1 (RPC layer, read-only; scanner НЕ должен трогать wallet/key path; paper/live boundary).

### Paper/live boundary (критично)

Scanner-service **не должен**:
- Импортировать `WalletManagerService`, `KeyVaultService`, `getEncryptedKey`, `decryptPrivateKey` (live wallet sign).
- Импортировать `@arbibot/capital-service`, `@arbibot/execution-orchestrator` (live write path).
- Импортировать `@arbibot/paper-trading-service` (paper write path).

Scanner-service **должен**:
- Использовать read-only RPC provider (без wallet).
- Взаимодействовать с другими сервисами только через HTTP (`signedFetch`).
- Shared types — через `@arbibot/contracts`.

Проверка: `bash tools/ci-paper-live-boundary.sh` (расширенный под scanner) → exit 0.

---

## 6. Deploy (после Phase 5)

### Paper-deploy (Aéza-like)

```bash
# 1. Build на хосте
npm run build -w @arbibot/scanner-service

# 2. PM2 (14-й сервис в stack)
pm2 start ecosystem.config.cjs --only scanner-service
# или npm run pm2:scanner

# 3. Verify
curl -s http://127.0.0.1:3021/health | jq .
pm2 logs scanner-service --lines 20

# 4. UI check
# /scanners в operator UI — инстансы видны, findings появляются
```

Env vars (см. `scanner-service-plan.md` Прил. A): `PORT`, `DATABASE_URL`, `RPC_SCANNER_*_URL`, `SCANNER_RPC_RATE_LIMIT_RPS`, `CONFIG_SERVICE_URL`, `OPPORTUNITY_SERVICE_URL`, `ARBIBOT_SERVICE_AUTH_SECRET`, и т.д.

### Pre-deploy verify

```bash
npm run verify:env          # .env валидация (scanner vars)
npm run verify:deployment   # composite pre-deploy
npm run db:verify-migrations:all
```

---

## 7. Quick reference — команды по фазам

| Фаза | Команда verify |
|---|---|
| Phase 0 | `npm run build` + `npm run db:migrate` + `node tools/verify-migrations-applied.mjs <scanner.sql>` |
| Phase 1 | `npm run dev:scanner` + runtime smoke §3 + unit tests |
| Phase 2 | unit tests (spread/filter/dedup) + integration test (full cycle) |
| Phase 3 | runtime smoke §3 (finding→opportunity→degradation) + Phase 3b outbox check |
| Phase 4 | `npm run build -w @arbibot/web` + frontend-review + hermes smoke |
| Phase 5 | `npm run ci:scanner-smoke` + `npm run ci:paper-live-boundary` + PM2 deploy + docs update |

---

## 8. Уроки (preemptive — из опыта Plan 5)

- **Не доверять статическим DoD для runtime-компонентов.** Каждый runtime-шаг → живой smoke.
- **RPC rate limit — реальная проблема.** Тестировать с conservative budget на публичных RPC; планировать dedicated endpoints в prod.
- **Config TTL задержка.** Operator disable должен применяться либо немедленно (force-refresh), либо с явным UI hint про TTL.
- **Volume на V2 — дорогой.** eth_getLogs full-range неприменим; short-window only.
- **OpportunityDetected без consumers — инфраструктурный задел.** Событие живёт в outbox, но Kafka bridge публикует только SnapshotUpdated. Consumers добавляются отдельно.

---

## Связанные документы

- [`docs/scanner-service-plan.md`](scanner-service-plan.md) — архитектурный план (17 решений).
- [`.cursor/plans/DEVELOPMENT_PLAN-SCANNER.md`](../.cursor/plans/DEVELOPMENT_PLAN-SCANNER.md) — step_ids.
- [`docs/review-gate-scanner.md`](review-gate-scanner.md) — review-gate чеклист.
- [`docs/lessons/hermes-agent-dod-failure.md`](lessons/hermes-agent-dod-failure.md) — урок «статические DoD недостаточны».
- [`docs/architecture-components.md`](architecture-components.md) — canonical карта компонентов.

---
*v1.0 — 2026-07-24*
