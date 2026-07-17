# Pre-Deploy Code Review — Arbibot 2

> ⚠️ **SUPERSEDED (2026-07-17):** значительная часть finding'ов (включая F1/mTLS, F6 alert-каталог, миграции) пересмотрена фазой **D4 deploy-readiness** (Plan 4, 2026-07-12→16).
> Актуальные процедуры — [`paper-deploy-dod.md`](paper-deploy-dod.md) (paper) / [`live-deploy-dod.md`](live-deploy-dod.md) (live) / [`release-process.md`](release-process.md).
> Документ сохранён как исторический consolidated gate; цифры миграций и метрик обновлены инлайн.

> **Single consolidated pre-deploy gate.** Этот документ консолидирует чеклист из 10 разделов (база/контракты/бизнес-потоки/API security/data security/execution safety/observability/frontend/приоритеты/порядок запуска) и отображает каждый пункт на конкретные артефакты, команды и находки этого репозитория. Он **не дублирует** существующие runbook-документы, а ссылается на них как на авторитетные источники.

**Версия документа:** 1.2 (2026-06-14) — sync §8.3 alert-каталога с фактическим `alerts.yml` (17 правил с mapping целевых имён → реализованные), F6 narrowed до единственного оставшегося backlog-alert (`KafkaPublishFailures`). v1.1 (2026-06-13): corrections pass по итогам аудита: N1 (nginx 80→80+443), N2 (network isolation nuance), N3 (миграции 036→037), sync alert-каталога 8.3 с `alerts.yml`, усиление F4/F3 бонусами реализации.
**Scope:** paper-first deployment → (после приёмки) live minimal capital.
**Связанные каноны:**
- [`docs/deployment-checklist.md`](deployment-checklist.md) — поэтапный деплой.
- [`docs/deployment-readiness-assessment.md`](deployment-readiness-assessment.md) — текущая готовность (100/100 paper-ready).
- [`docs/ci-verification-checklist.md`](ci-verification-checklist.md) — CI verification.
- [`docs/security-baseline.md`](security-baseline.md) — mTLS, secrets, segmentation.
- [`docs/observability-tracing.md`](observability-tracing.md) — SLO и alerts.
- [`docs/outbox-inbox.md`](outbox-inbox.md) — bus path.
- [`docs/reservation-first.md`](reservation-first.md) — execution invariant.
- [`.cursor/rules/verification-methodology.mdc`](../.cursor/rules/verification-methodology.mdc) — методология верификации.

---

## 0. Назначение и два режима готовности

Документ различает **два уровня готовности**, потому что архитектура Arbibot 2 явно поддерживает paper-first путь к продакшену:

| Режим | Описание | Что обязано быть зелёным |
|-------|----------|---------------------------|
| **PAPER-READY** | Первый деплой — paper trading на стейджинге/проде для сквозной проверки стека без реальных потерь. | Все разделы 1–8 с пометкой `[PAPER]`. |
| **LIVE-READY** | Включение live trading с минимальным капиталом. | Все разделы 1–8, плюс `[LIVE-ONLY]` пункты (mTLS, Vault, audit-hardening, key rotation drill). |

Каждый пункт ниже помечен явно. Если блок `[LIVE-ONLY]` не пройден — это **блокер для live**, но не блокер для paper-deploy.

---

## 1. Findings разведки (ТОП-5 рисков, требуют подтверждения)

Эти находки выявлены при анализе кода/конфигов **до деплоя** и требуют явного решения.

### 🔴 F1. Backend NestJS-сервисы не имеют auth guard

**Где:** `apps/*/src/main.ts` (risk, opportunity, capital, execution, audit, canonical, intake, portfolio, reconciliation, paper, config) вызывают только `applyArbibotHttpSecurity` (helmet + rate-limit + CORS). Ни один сервис не регистрирует `AuthGuard` глобально. Аутентификация держится **исключительно на network isolation** в `infra/docker-compose.prod.yml` (публикуется только `nginx:80`/`443` — TLS termination, остальные сервисы в сети `arbibot-backend`, без `ports:`).

**Исключения (имеют guard):** `apps/hermes-gateway` (`HermesAuthGuard` — проверка `x-hermes-api-key`).

**Риск:** Любая утечка сети/портов (docker inspect, override, debug-port, sidecar) → полный unauthenticated доступ к `/execution/plans/:id/arm`, `/capital/reserve`, `/policy/jobs/*`. Для trading-системы это unacceptable для live.

**Remediation:**
- `[PAPER]` — подтверждение, что `infra/docker-compose.prod.yml` публикует **только** `nginx:80`/`443` (TLS termination), все backend-сервисы без `ports:`, firewall deny-all извне.

> **⚠️ N2 — нюанс изоляции (synced с `docker-compose.prod.yml:521-527`, 2026-06-13):** сеть `arbibot-backend` **не** помечена `internal: true` (`internal: false`). Изоляция держится **только** на отсутствии `ports:` у backend-сервисов и на firewall-политике хоста, **а не** на docker network enforcement. `arbibot-observability`, напротив, имеет `internal: true`. **Следствие для review:** любой случайный `ports:` в override-файле, debug-port или проброс через sidecar обнажит unauthenticated-сервисы — это нужно явно проверять в review каждого override/compose-изменения.
- `[LIVE-ONLY]` — добавить service-to-service auth guard (HMAC или mTLS на Fastify hook); завести отдельную задачу (см. раздел 10 этого документа, «Post-paper backlog»).

**Связанные документы:** [`docs/security-baseline.md`](security-baseline.md) (mTLS — целевое состояние, но «не в scope»).

---

### ✅ F2. Несоответствие env-имён в `tools/validate-env.sh` (RESOLVED)

**Статус:** Исправлено — `tools/validate-env.sh` теперь валидирует `HERMES_API_KEYS` / `HERMES_BFF_API_KEY` (см. commit). `.env.production.example` синхронизирован: все `OPENCLAW_*` → `HERMES_*`.

**Где:** `tools/validate-env.sh` валидирует `OPENCLAW_API_KEYS` / `OPENCLAW_BFF_API_KEY` (строки 94–95), тогда как:
- guard `apps/hermes-gateway/.../hermes-auth.guard.ts` читает `HERMES_API_KEYS`;
- BFF в `apps/web/...` читает `HERMES_BFF_API_KEY`;
- README, AGENTS.md, `.env.example` — всё на `HERMES_*`.

**Риск:** Валидатор «зелёный» даже если `HERMES_API_KEYS` не выставлен → Hermes-интеграция падает в проде, operator automation недоступна.

**Remediation:** ~~Переименовать `OPENCLAW_*` → `HERMES_*` в `tools/validate-env.sh`.~~ **ВЫПОЛНЕНО** (см. F2.1 — `.env.production.example` также синхронизирован).

---

### ✅ F3. `tools/verify-deployment.sh` проверяет прямые порты, не публикуемые в prod (RESOLVED)

**Статус:** Исправлено — добавлен режим `VERIFY_MODE=isolated` (default: `direct` для dev/local). В isolated-режиме проверяются только nginx `/health` + web BFF + `docker exec` для in-network checks.

> **✅ Бонус (сильнее обещанного):** для canonical registry в isolated-режиме используется BFF-маршрут `/api/operator/canonical/instruments` (`verify-deployment.sh:273-277`), а не прямой порт canonical-market-service — это предотвращает ложный FAIL даже когда сервис не опубликован наружу.

**Где:** `tools/verify-deployment.sh` строки 162–170 делают `curl http://${BASE_URL}:3000/metrics`, `:3010`, `:3012`, `:3018`, `:3019`, `:3020`. В `infra/docker-compose.prod.yml` эти порты **не публикуются** наружу (только `nginx:80`/`443`), потому в изолированном prod-деплое эти проверки возвращали `000` / FAIL, маскируя реальные проблемы.

**Риск:** Шум в verifications → оператор начинает игнорировать FAIL, пропуская реальные поломки.

**Remediation (отдельная задача):** Добавить режим `VERIFY_MODE=isolated` (проверка через `nginx /health` + `docker exec` для backend-сервисов) или явно пометить прямые порты как `SKIP_SERVICES`. Заведено как backlog.

---

### 🟠 F4. `ARBIBOT_DEV_ROLE` env-fallback активен в production

**Где:**
- `apps/web/lib/operator-session.ts:35` — `getOperatorSession` возвращает env-role без проверки `NODE_ENV`.
- `apps/web/middleware.ts:16` — то же в middleware.

Dev-default `'operator'` отключается в prod (`NODE_ENV !== 'production'`), но **env-fallback остаётся**. Если оператор случайно выставит `ARBIBOT_DEV_ROLE=admin` в `.env` продакшена — весь RBAC обходится.

**Риск:** Случайная или злонамеренная установка env bypasses RBAC в проде.

**Remediation:**
- `[PAPER + LIVE]` — подтвердить, что `.env` продакшена **не содержит** `ARBIBOT_DEV_ROLE` (проверка через `validate-env.sh` после исправления F2).

  > **✅ Бонус (сильнее обещанного, synced с `tools/validate-env.sh:266-269`, 2026-06-13):** `validate-env.sh` не просто предупреждает о `ARBIBOT_DEV_ROLE`, а **блокирует deploy** (`log_fail` → `FAIL += 1` → `exit 1`, см. строки 318-321). Дополнительно `.env.production.example:59-63` явно комментирует переменную с предупреждением и ссылкой на F4.
- `[LIVE-ONLY]` — сделать env-fallback noop в production (отдельная задача, см. F4 в разделе 11).

---

### 🟡 F5. `deployment-readiness-assessment.md` = 100/100, но это PAPER-ready

**Где:** [`docs/deployment-readiness-assessment.md`](deployment-readiness-assessment.md) декларирует 100% готовность, но в самом документе признаются пробелы:
- mTLS не реализован (см. F1).
- Vault не интегрирован (секреты в `.env`).
- `npm audit` / Trivy не подключены к CI.
- Threat model и pen-test не проведены.

**Риск:** Оператор читает «100/100» и включает live без проверки `[LIVE-ONLY]` пунктов.

**Remediation:** Этот документ явно разводит PAPER-READY и LIVE-READY; cross-link добавлен в `deployment-readiness-assessment.md`.

---

## 2. Раздел 1 — База и сборка

**Цель:** подтвердить, что проект стабильно собирается, тесты проходят, миграции применяются, локально и в CI поведение совпадает.

### Команды gate (выполнять последовательно, каждая должна PASS)

| # | Команда | Ожидаемый результат | При FAIL |
|---|---------|---------------------|----------|
| 1.1 | `npm run lint` | Turbo lint — 0 errors (28/28 packages green по AGENTS.md) | Не деплоить. Пофиксить lint. |
| 1.2 | `npm run build` | Turbo build — 21/21 packages green | Проверить `tsconfig.build.json`, `dist/main.js` под `apps/*/dist/`. |
| 1.3 | `npm run test` | Turbo test — 392/392 tests, 27 suites green | Изолировать падающий suite, прогнать локально `-w @arbibot/<pkg>`. |
| 1.4 | `npm run db:migrate` | Миграции 001–043 применены без ошибок (включая `037_fix_get_effective_config_value.sql`, `038_alertmanager_incidents.sql`, `039_dex_daily_volume.sql`, `040_portfolio_positions_notional_usd.sql`, `041_capital_limits_seed.sql`, `042_wallet_keys.sql`, `043_bridge_finality.sql`) | Проверить `DATABASE_URL`, `infra/postgres/migrations/`. |
| 1.5 | `npm run db:verify-migrations:all` | Все 37 строк в `schema_migrations` | Если номер < 37 — повторить 1.4. |

### Дополнительные проверки

- **Node parity:** CI использует Node 22 (см. `.github/workflows/ci.yml:16`); `package.json:7` требует `>=22.0.0`. Локальный `node -v` должен совпасть.
- **Lockfile discipline:** `git diff --stat package-lock.json` после `npm ci` — пустой. Любые изменения — незапланированный dependency drift.
- **Docker images (если деплой через compose):** `bash tools/docker-build-all.sh` должен пройти без ошибок.
- **CI parity:** jobs `build`, `e2e-phase2`, `e2e-phase2-watchlist-route-scoring`, `e2e-phase3-paper-promotion`, `e2e-phase3-paper-discovery`, `e2e-phase4-tier-routing`, `bus-smoke` — все зелёные на `main` (см. `docs/ci-verification-checklist.md`).

**Артефакты:** [`package.json`](../package.json), [`.github/workflows/ci.yml`](../.github/workflows/ci.yml), [`docs/ci-verification-checklist.md`](ci-verification-checklist.md).

---

## 3. Раздел 2 — Контракты и интеграции

**Цель:** подтвердить корректность всех HTTP/async-контрактов и outbox/inbox-цепочек.

### 2.1 OpenAPI / HTTP-контракты

| Проверка | Где | Ожидание |
|----------|-----|----------|
| Контракт существует и валиден | `docs/openapi-draft.yaml` | Парсится, содержит endpoints всех сервисов |
| Endpoints покрывают paths | Каждый `apps/*/src/**/*.controller.ts` | Совпадение path/method с OpenAPI |
| DTOs строгие | `apps/*/src/**/*.dto.ts` | `class-validator` decorators, no `any` |

**Команда spot-check:** сравнить декларации `@Controller('/...')` и `@Get/@Post` с `docs/openapi-draft.yaml`.

### 2.2 AsyncAPI / JSON Schema для событий

| Проверка | Где | Ожидание |
|----------|-----|----------|
| События задокументированы | `docs/async-events.md` | 9 событий: SnapshotUpdated, OpportunityDetected, RiskDecisionIssued, CapitalReserved, PlanArmed, LegFilled, ReconciliationMismatchDetected, PlanCompleted, PositionClosed |
| Envelope fields | Каждый event type | messageId, correlationId, causationId, entityType, entityId, version, sourceModule, eventTs |
| Payload versioned | `packages/messaging/` | Каждое событие имеет версию в payload |

### 2.3 Outbox relay (opportunity → paper, in-DB)

| Проверка | Где | Ожидание |
|----------|-----|----------|
| Allowlist согласован | `apps/opportunity-service/.../outbox-relay.service.ts` | `RiskDecisionIssued`, `PaperPromotionCandidateRequested` |
| Дедуп для paper-enqueue | Миграция `018_outbox_paper_enqueue_dedup.sql` | Pending-row unique constraint работает |
| Idempotent commit на paper | `apps/paper-trading-service` | `enqueueIdempotencyKey` обрабатывает дубли |

### 2.4 Kafka bridge

| Проверка | Где | Ожидание |
|----------|-----|----------|
| Allowlist bridge | `packages/outbox-kafka-bridge` | SnapshotUpdated, CapitalReserved, PlanArmed, LegFilled, PlanCompleted |
| Нет double-publish | `docs/outbox-inbox.md` | Bridge и in-DB relay не пересекаются по типам |

### 2.5 Inbox deduplication (paper-trading-service)

| Проверка | Где | Ожидание |
|----------|-----|----------|
| Idempotency key | Миграция `017_paper_promotion_enqueue_idempotency.sql` | UNIQUE constraint |
| Replay-safe handler | `apps/paper-trading-service` | Повторная доставка не создаёт duplicate paper-trade |

### 2.6 Smoke bus-check

**Команды:**

```bash
# Локально (Docker Desktop):
docker compose -f infra/docker-compose.dev.yml --profile bus up -d
npm run bus:publish      # publish SnapshotUpdated etc. to Kafka
npm run bus:consume      # consumer group arbibot-bus-smoke

# CI-эквивалент:
npm run ci:bus-smoke

# Ручная сид-вставка для bus-smoke:
npm run seed:outbox-smoke-events:all
```

**Ожидание:** consumer логирует `eventName` и `entityType` на успешном claim; все 5 типов в Kafka-топике `arbibot.domain.events`.

**Артефакты:** [`docs/outbox-inbox.md`](outbox-inbox.md), [`tools/ci-bus-smoke.sh`](../tools/ci-bus-smoke.sh), [`tools/seed-outbox-events.mjs`](../tools/seed-outbox-events.mjs).

---

## 4. Раздел 3 — Критические бизнес-потоки

**Цель:** end-to-end проверить путь intake → opportunity → risk → capital → execution → portfolio → reconciliation.

### 3.1 E2E scripts (прогнать все активные для текущей фазы)

| # | Команда | Что покрывает | Требования |
|---|---------|---------------|------------|
| 3.1.1 | `npm run e2e:phase1-foundation` | snapshot → opportunity → risk → reserve → arm | DB migrated, services on портах 3000/3010/3011/3012/3015 |
| 3.1.2 | `npm run e2e:phase2-controlled-execution` | Plan legs до `completed` | + lab venue (`tools/lab-venue-stand.mjs`) |
| 3.1.3 | `npm run e2e:phase3-paper-promotion` | paper promotion relay + capital reservation | paper-trading-service + opportunity-service |
| 3.1.4 | `npm run ci:e2e-phase3-paper-discovery` | discovery worker + candidates | paper-trading + market-intake |
| 3.1.5 | `npm run e2e:phase4-tier-routing` | intake tier routing + throttle | risk + config + market-intake |

**CI-обёртки:** `npm run ci:e2e-phase2`, `ci:e2e-phase2-watchlist-route-scoring`, `ci:e2e-phase3`, `ci:e2e-phase3-paper-discovery`, `ci:e2e-phase4-tier-routing` (см. `.github/workflows/ci.yml`).

### 3.2 Invariant checks (read-only аудит кода)

| Инвариант | Где | Как проверить |
|-----------|-----|---------------|
| Reservation-first | `apps/execution-orchestrator/.../plans.service.ts` | `arm` возвращает 409 без valid reservation |
| Single-writer на ExecutionPlan | только execution-orchestrator | grep `INSERT INTO execution_plans` / `UPDATE execution_plans` |
| Idempotent fill commit | `apps/execution-orchestrator/.../legs.service.ts` | `apply-fill` с одним `fillId` дважды → второй no-op |
| Versioned state transitions | TypeORM `@VersionColumn` или CAS | `planned → reserved → armed → executing → completed` |
| Reconciliation detector | `apps/reconciliation-service` | `completed_plan_missing_portfolio` срабатывает |

### 3.3 Paper gating (если релиз затрагивает paper)

- `POST /opportunities/:id/paper-enqueue` пишет в outbox, relay доставляет в paper-trading-service (idempotent).
- Paper capital reservation TTL 60 минут, фоновый expiry.
- Promotion requires quality score (см. `docs/paper-promotion-quality-criteria.md`).

**Артефакты:** [`docs/reservation-first.md`](reservation-first.md), [`docs/state-machines.md`](state-machines.md), [`docs/e2e-scenarios.md`](e2e-scenarios.md), [`docs/settlement-post-commit.md`](settlement-post-commit.md).

---

## 5. Раздел 4 — Безопасность API

**Цель:** RBAC, middleware, operator endpoints, HERMES gateway, audit.

### 4.1 RBAC

| Проверка | Где | Ожидание |
|----------|-----|----------|
| Cookie-based role | `apps/web/middleware.ts` | `arbibot_role` cookie, `minimumRoleForPathname` для каждого защищённого path |
| Env-fallback отключён в prod | `apps/web/lib/operator-session.ts` | `NODE_ENV=production` → dev-default `'operator'` не возвращается (env-fallback см. F4) |
| Все `/api/operator/*` покрыты matcher | `apps/web/middleware.ts:68` | matcher включает `/api/operator/:path*` |
| Insufficient role → 403 | middleware | `OPERATOR_INSUFFICIENT_ROLE` JSON |

**Подтвердить (F4):** `.env` продакшена НЕ содержит `ARBIBOT_DEV_ROLE` — это **автоматически блокируется** `validate-env.sh` (exit 1 при наличии, см. bonus в F1/F4 раздела 1).

### 4.2 Destructive operator actions

| Проверка | Где | Ожидание |
|----------|-----|----------|
| Impact preview обязателен | `apps/web/components/destructive-operator-action.tsx` | Все `level="high"` действия с `impactPreview` |
| Typed-confirmation phrase | тот же компонент | `requireTypedConfirmPhrase` для high-risk (FORCE HEDGE, ARM, EXECUTE, CLOSE, KILL SWITCH, CANCEL TX) |
| All destructive flows covered | `grep -r "DestructiveOperatorAction" apps/web/components` | settings, dex, hermes, incidents, paper-promotion |
| Audit log entry | backend mutations | `AuditClientService.appendEntry` для каждой мутации |

**Покрытие (59 matches по DestructiveOperatorAction):** `dex-operator-actions.tsx`, `dex-config/dex-limits-panel.tsx`, `dex-config/dex-live-panel.tsx`, `hermes/hermes-workspace.tsx`, `incidents-workspace.tsx`, `settings-policy-editor-panels.tsx`, `settings-workspace.tsx`.

### 4.3 HERMES gateway auth

| Проверка | Где | Ожидание |
|----------|-----|----------|
| Guard активен | `apps/hermes-gateway/.../hermes-auth.guard.ts` | Проверка `x-hermes-api-key` |
| BFF проксирует с server-side key | `apps/web/.../api/operator/hermes/v1/[[...path]]/route.ts` | `HERMES_BFF_API_KEY` inject, не exposed клиенту |
| Mutations требуют operator session | BFF POST/PATCH | session check + `operatorId` inject |

**Подтвердить (F2):** ✅ env-валидатор проверяет `HERMES_API_KEYS` / `HERMES_BFF_API_KEY` (RESOLVED, 2026-06-13).

### 4.4 HTTP hardening (`applyArbibotHttpSecurity`)

| Проверка | Ожидание |
|----------|----------|
| helmet | Включён во всех `apps/*/src/main.ts` |
| Rate limiting | Включён (параметризованный per-endpoint) |
| CORS | `CORS_ORIGINS` — явные origins, не `*` |
| `x-correlation-id` | Прокидывается во все логи/метрики |

### 4.5 Backend auth = network isolation (F1, критично)

| Режим | Проверка |
|-------|----------|
| `[PAPER]` | `infra/docker-compose.prod.yml`: только `nginx:80`/`443` в `ports:` (TLS termination), все backend-сервисы без `ports:`. **⚠️ N2 нюанс изоляции:** `arbibot-backend` **не** имеет `internal: true` (`docker-compose.prod.yml:521-524`), `arbibot-observability` — имеет (`internal: true`). Защита backend держится на отсутствии `ports:` + firewall хоста, **не** на docker network enforcement — проверять override-файлы и sidecars на отсутствие случайно добавленных `ports:`. |
| `[LIVE-ONLY]` | Service-to-service auth guard или mTLS (отдельная задача). |

### 4.6 Audit logging

| Проверка | Где | Ожидание |
|----------|-----|----------|
| Config mutations | `apps/config-service` | `AuditClientService.appendEntry` |
| Paper mutations | `apps/paper-trading-service` | `approve/reject/cancel` → audit |
| HERMES mutations | `apps/hermes-gateway` | `arm/execute/resolve/safe-mode` → audit |
| Execution mutations | `apps/execution-orchestrator` | state transitions → audit |

### 4.7 Нет debug/seed в production

| Проверка | Ожидание |
|----------|----------|
| `AUDIT_CLIENT_ENABLED=true` в prod env | validate-env.sh section 6 |
| `INTAKE_THROTTLING_ENABLED=true` | включен |
| Нет `MOCK_VENUE_*` в prod env | кроме случаев явного paper-теста |
| `PAPER_DISCOVERY_ENABLED` — явно `true`/`false` | не неопределён |

---

## 6. Раздел 5 — Безопасность данных

**Цель:** секреты, конфиги, токены, PII/операторские данные.

### 6.1 Секреты не в репозитории/логах

| Проверка | Ожидание |
|----------|----------|
| `.env` в `.gitignore` | да |
| `.env.example` без prod-значений | только placeholders `<CHANGE_ME>` |
| `grep -ri "PRIVATE_KEY\|password\|secret\|apiKey" apps/ packages/` | нет хардкода |
| Логи не содержат secrets | код логирует только `correlationId`, `entityId`, не payload целиком |

### 6.2 Env validation

**Команда:**

```bash
ENV_FILE=infra/.env npm run verify:env
```

**Ожидание:** PASS (exit 0) или PASS w/ warnings (exit 2). FAIL (exit 1) — блокер.

**Подтвердить (F2):** ✅ Валидатор проверяет `HERMES_API_KEYS` (не `OPENCLAW_*`) — RESOLVED. Дополнительно: `.env.production.example` синхронизирован (F2.1).

### 6.3 KeyVault / Key rotation

| Проверка | Где | Ожидание |
|----------|-----|----------|
| KeyVaultService использует AES-256-GCM | `apps/execution-orchestrator/.../key-vault.service.ts` | hex storage, Buffer crypto |
| Key rotation runbook существует | `docs/key-rotation-runbook.md` | 90-day плановая + emergency flow |
| Wallet cache invalidation | `WalletManagerService.clearWalletCache()` | вызывается при rotation |

`[LIVE-ONLY]` — провести **drill** ротации на стейджинге до live.

### 6.4 Доступ к данным

| Ресурс | Ожидание |
|--------|----------|
| PostgreSQL | `POSTGRES_USER` — не superuser в prod; PgBouncer pooling; TLS |
| Redis | `requirepass`, не default port expose |
| Kafka/Redpanda | SASL/SSL, не plaintext listener в prod |
| S3 (если есть snapshots/replay) | минимальные IAM permissions, bucket encryption |
| Logs (Loki) | не содержат secrets, retention policy задан |

`[LIVE-ONLY]` — encryption at-rest для Postgres volumes, S3 bucket encryption, TLS in-transit everywhere.

### 6.5 Ротация ключей

| Тип | Период | Runbook |
|-----|--------|---------|
| DEX wallet keys | 90 дней | [`docs/key-rotation-runbook.md`](key-rotation-runbook.md) |
| `HERMES_API_KEYS` | 90 дней | (нет runbook — backlog) |
| DB password | policy-driven | (через Vault — backlog) |
| TLS cert | 90 дней (Let's Encrypt auto) | `tools/generate-tls-certs.sh` для self-signed |

---

## 7. Раздел 6 — Защита от ошибок исполнения

**Цель:** для trading-системы это часть безопасности.

### 7.1 Reservation-first

| Инвариант | Как проверить |
|-----------|---------------|
| `arm` требует reservation | `POST /execution/plans/:id/arm` → 409 без `reservationId` |
| `reservation.expiresAt` проверяется | orchestrator reject arm после expiry |
| `CapitalReserved` до `PlanArmed` | проверить порядок событий в outbox |
| `execute` требует `armed` state | state machine guard |

**Контракт:** [`docs/reservation-first.md`](reservation-first.md).

### 7.2 Single-writer

| Сущность | Единственный writer |
|----------|---------------------|
| `ArbitrageOpportunity` | opportunity-service |
| `RiskDecision` | risk-service |
| `ExecutionPlan` | execution-orchestrator |
| `CapitalReservation` | capital-service |
| `PortfolioPosition` | portfolio-service |
| `PaperTrade` | paper-trading-service |

**Аудит:** `grep -r "INSERT INTO execution_plans\|UPDATE execution_plans" apps/` — только execution-orchestrator.

### 7.3 Versioned state transitions

| Проверка | Ожидание |
|----------|----------|
| Optimistic concurrency | TypeORM `@VersionColumn` или manual CAS |
| State machine guards | `planned → reserved → armed → executing → completed/hedged/unwound/failed/canceled` |
| Invalid transition rejected | 409 Conflict |
| Concurrent update retry | caller повторяет с backoff |

**Контракт:** [`docs/state-machines.md`](state-machines.md).

### 7.4 Idempotent commit

| Событие | Idempotency key |
|---------|-----------------|
| Paper enqueue | `enqueueIdempotencyKey` (migration `017`) |
| Paper enqueue dedup | `paper_enqueue_idempotency_key` (migration `018`) |
| Fill commit | `fillId` (execution-orchestrator) |
| Position close | `close_idempotency_key` (migration `031`) |

**Тест:** повторный `POST /apply-fill` с тем же `fillId` → no-op, не создаёт второй ордер.

### 7.5 Compensation / rollback

| Сценарий | Поведение |
|----------|-----------|
| Partial fill | `arb_execution_leg_partial_fill_commits_total` increments, leg → `partiallyFilled` |
| Force hedge / unwind | impact preview + 2-step approval + audit |
| Reconciliation mismatch | detector `completed_plan_missing_portfolio`, `POST /mismatches/run-detectors` |

**Контракты:** [`docs/partial-fill-playbooks.md`](partial-fill-playbooks.md), [`docs/reconciliation-p0-procedures.md`](reconciliation-p0-procedures.md), [`docs/dex-rollback-strategy.md`](dex-rollback-strategy.md).

---

## 8. Раздел 7 — Observability и инциденты

**Цель:** метрики, логи, трассировки, alerting, runbooks.

### 8.1 Метрики (`GET /metrics` на каждом сервисе)

| Метрика | Тип | Назначение |
|---------|-----|------------|
| `http_request_duration_seconds` | histogram | latency p50/p95/p99 per service |
| `arb_http_requests_total` | counter | error rate |
| `arb_execution_leg_partial_fill_commits_total` | counter | partial fill rate |
| `arb_intake_throttled_total` | counter | throttle rate |
| `arb_intake_degradation_active` | gauge | degraded mode |
| `arb_paper_drift_bps_current` | gauge | paper drift |
| `arb_dex_swap_total` | counter | DEX swap success rate |
| `arb_dex_rpc_latency_seconds` | histogram | DEX RPC latency |
| `arb_hermes_safe_mode_redis_errors_total` | counter | Hermes safe-mode |

### 8.2 Логи и tracing

| Проверка | Ожидание |
|----------|----------|
| `correlationId` в каждом log line | во всех сервисах |
| OpenTelemetry SDK | `startOpenTelemetryNodeSdkIfConfigured` в `apps/*/src/main.ts` |
| OTLP endpoint configurable | `OTEL_EXPORTER_OTLP_ENDPOINT` |
| Loki ingestion | promtail config в `infra/promtail/` |

**Контракт:** [`docs/observability-tracing.md`](observability-tracing.md).

### 8.3 Alerts

> **Примечание (synced с `infra/prometheus/alerts.yml`, 2026-06-14):** в `alerts.yml` **реализовано 17 правил** в 9 группах. Ранние версии этого документа оперировали целевыми/каталожными именами (`ArbibotHttp5xxRate`, `ArbibotServiceUptime`, `IntakeDegradationStale`, `ArbibotHttpLatencyP99`, `OutboxRelayLag`, `KafkaPublishFailures`, `ReconciliationOpenMismatches`) — часть из них теперь реализована под другими именами (см. mapping ниже), часть остаётся backlog.

#### Реализованные правила (17 шт.)

| Alert | Severity | Когда срабатывает | Expr (кратко) |
|-------|----------|-------------------|---------------|
| `ServiceDown` | critical | target down 2m | `up == 0` |
| `HighErrorRate` | warning | 5xx rate > 5% за 5m | `rate(http_requests_total{status=~"5.."}[5m]) / rate(http_requests_total[5m]) > 0.05` |
| `PaperDriftBpsHigh` | warning | paper drift avg > 50 bps за 5m | `arb_paper_drift_bps_avg_5m > 50` |
| `PaperDriftBpsSustainedHigh` | critical | paper drift max > 30 bps за 15m | `arb_paper_drift_bps_max_15m > 30` |
| `DEXUnhealthy` | critical | DEX health = unhealthy 3m | `arb_dex_health_status{status="unhealthy"} == 0` |
| `DEXRPCDegraded` | warning | DEX RPC degraded 10m | `arb_dex_health_status{status="degraded"} == 0.5` |
| `HighMemoryUsage` | warning | RSS > 400 MB за 10m | `process_resident_memory_bytes / 1024 / 1024 > 400` |
| `IntakeDegraded` | warning | intake degradation active 5m | `arb_intake_degradation_active == 1` |
| `ReconciliationMismatches` | warning | > 5 mismatches за 15m | `increase(arb_reconciliation_mismatches_total[15m]) > 5` |
| `CapitalExhaustion` | critical | available capital < $1000 за 5m | `arb_capital_available_usd < 1000` |
| `ExecutionPlanStuck` | warning | plan в `armed`/`executing` > 10m | `time() - arb_execution_plan_state_changed_timestamp_seconds{state=~"armed\|executing"} > 600` |
| `OutboxRelayBacklog` | warning | pending outbox events > 100 за 5m | `arb_outbox_relay_pending_total > 100` |
| `DiskSpaceLow` | warning | disk free < 15% за 10m | `node_filesystem_avail_bytes / node_filesystem_size_bytes < 0.15` |
| `SLOFastBurnCritical` | critical | 2% error budget за 1h (14.4× burn) | SLO multi-window multi-burn-rate (Google SRE Workbook §5) |
| `SLOSlowBurnCritical` | critical | 5% error budget за 6h (6× burn) | SLO multi-window multi-burn-rate |
| `SLOMediumBurnWarning` | warning | 10% error budget за 3d (1× burn) | SLO multi-window multi-burn-rate |
| `SLOLatencyFastBurn` | critical | p99 > 500ms за fast window (Tier 1 SLO) | `http_request_duration_seconds_bucket{le="0.5"}` ratio |

#### Mapping целевых имён → реализация

| Целевое имя (ранние docs / catalog) | Статус | Реализованное имя |
|-------------------------------------|--------|-------------------|
| `ArbibotHttpLatencyP99` | ✅ реализован | `SLOLatencyFastBurn` (Tier 1 latency SLO, 500ms p99) |
| `OutboxRelayLag` | ✅ реализован | `OutboxRelayBacklog` (pending > 100 за 5m) |
| `ReconciliationOpenMismatches` | ✅ реализован | `ReconciliationMismatches` (mismatches за 15m window) |
| `KafkaPublishFailures` | ⚠️ **backlog** | нет в `alerts.yml` (ожидает bridge error counter) — см. F6 |

**Backlog (1 правило, см. F6 в разделе 11):** `KafkaPublishFailures` — требует экспорта `arb_outbox_kafka_bridge_publish_failures_total` счётчика из `@arbibot/outbox-kafka-bridge`; после этого добавить правило в `infra/prometheus/alerts.yml` (группа `messaging`).

**Файлы:** `infra/prometheus/alerts.yml`, `infra/alertmanager/`, `docs/observability-tracing.md` (alert catalog — целевые имена).

### 8.4 Grafana dashboards

| Dashboard | UID | Назначение |
|-----------|-----|------------|
| HTTP overview | arb-http-overview | latency/error rate per service |
| Risk policy writers | arb-risk-policy-writers | watchlist/route-scoring writers |
| Paper trading | arbibot-paper-trading | paper trades, drift, promotions |
| DEX overview | arb-dex-overview | DEX swap/RPC/gas |

**Проверка:** импорт dashboards в Grafana, datasource Prometheus, manual query.

### 8.5 Runbooks

- [`docs/incident-response-playbook.md`](incident-response-playbook.md)
- [`docs/disaster-recovery-plan.md`](disaster-recovery-plan.md)
- [`docs/reconciliation-p0-procedures.md`](reconciliation-p0-procedures.md)
- [`docs/intake-degradation-runbook.md`](intake-degradation-runbook.md)
- [`docs/hermes-safe-mode-runbook.md`](hermes-safe-mode-runbook.md)
- [`docs/hermes-gateway-runbook.md`](hermes-gateway-runbook.md)
- [`docs/dex-runbook-bridge.md`](dex-runbook-bridge.md)
- [`docs/dex-runbook-failed-tx.md`](dex-runbook-failed-tx.md)
- [`docs/dex-rollback-strategy.md`](dex-rollback-strategy.md)
- [`docs/key-rotation-runbook.md`](key-rotation-runbook.md)

### 8.6 SLO (v1, agreed)

| Tier | Latency p99 | Availability |
|------|-------------|--------------|
| Critical (opportunity, risk, orchestrator) | 300 ms | 99.9% |
| Standard (canonical, intake, audit, portfolio, reconciliation) | 2 s | 99.5% |
| Read-only (dashboard, config, paper) | 5 s | 99% |

---

## 9. Раздел 8 — Фронтенд и operator UI

**Цель:** не визуальные баги, а безопасность операторских действий.

### 9.1 RBAC-скрытие

| Проверка | Где | Ожидание |
|----------|-----|----------|
| Недоступные actions скрыты | `apps/web/components/*` | Кнопки conditional по `session.role` |
| `minimumRoleForPathname` | `apps/web/lib/operator-role.ts` | Каждая страница имеет min role |
| `/settings` mutations | `settings-workspace.tsx` | admin-only для promote/rollback |

### 9.2 Impact preview + typed-confirm

| Action | Component | Phrase |
|--------|-----------|--------|
| Force hedge/unwind | (backlog — `DestructiveOperatorAction` готов) | — |
| ARM plan | `hermes-workspace.tsx` | `ARM` |
| EXECUTE plan | `hermes-workspace.tsx` | `EXECUTE` |
| CLOSE position | `hermes-workspace.tsx` | `CLOSE` |
| Resolve incident | `incidents-workspace.tsx` | `Mark resolved` |
| Save config | `settings-workspace.tsx` + panels | `APPROVE` |
| Rollback / Promote | `settings-workspace.tsx` | `Rollback/Promote` |
| DEX speed-up / cancel | `dex-operator-actions.tsx` | `SPEED UP/CANCEL TX` |
| DEX kill switch | `dex-config/dex-limits-panel.tsx` | `KILL SWITCH` |

### 9.3 Изоляция данных по ролям

| Проверка | Ожидание |
|----------|----------|
| Operator видит только свои tenant данные | BFF scope по `operatorId` |
| Tables/filters не показывают чужой scope | нет утечек между ролями |
| API errors не expose internals | generic messages, no stack traces в UI |

### 9.4 Безопасность форм

| Проверка | Ожидание |
|----------|----------|
| Forms отправляют только нужные поля | нет mass-assignment |
| DTOs на backend валидируют | `class-validator` whitelist |

---

## 10. Раздел 9 — Приоритеты при нехватке времени

Короткая последовательность «must-pass» (если времени мало):

1. `npm run lint && npm run build && npm run test` — gate.
2. `npm run db:migrate && npm run db:verify-migrations:all` — схема.
3. E2E critical path: `e2e:phase1-foundation` + `e2e:phase2-controlled-execution` + `e2e:phase3-paper-promotion`.
4. **RBAC + destructive actions** (раздел 4.2, 4.3, 9.2) — operator safety.
5. **Outbox/inbox + bus-smoke** (`npm run ci:bus-smoke`).
6. **Secrets/env/headers/logs** (раздел 5 + 6 + F4).
7. **Reconciliation + rollback scenarios** (раздел 7.5).

Остальные разделы — «желательно», но не блокер paper-deploy.

---

## 11. Раздел 10 — Практический порядок запуска (gate-sequence)

```
┌─────────────────────────────────────────────────────────────────┐
│ STAGE 0 — Build & Test gate                                     │
│   npm run lint        → 0 errors                                │
│   npm run build       → 21/21 packages                          │
│   npm run test        → 392/392 tests                           │
│   npm ci parity check → lockfile unchanged                      │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ STAGE 1 — Schema gate                                           │
│   npm run db:migrate             → 001–043 applied               │
│   npm run db:verify-migrations:all → all rows in schema_migrations│
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ STAGE 2 — E2E critical path                                     │
│   npm run e2e:phase1-foundation                                  │
│   npm run e2e:phase2-controlled-execution                        │
│   npm run e2e:phase3-paper-promotion                             │
│   npm run ci:e2e-phase3-paper-discovery                          │
│   npm run e2e:phase4-tier-routing                                │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ STAGE 3 — Bus / Contracts gate                                  │
│   npm run ci:bus-smoke        → consumer logs eventName          │
│   audit: outbox allowlist vs docs/async-events.md                │
│   audit: JSON Schema for events                                  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ STAGE 4 — Security review                                       │
│   ENV_FILE=infra/.env npm run verify:env   → PASS / PASS w/warn  │
│   audit: RBAC middleware matcher (4.1)                           │
│   audit: DestructiveOperatorAction coverage (4.2)                │
│   audit: HERMES guard (4.3)                                      │
│   audit: network isolation in compose (4.5, F1)                  │
│   audit: env files не содержат ARBIBOT_DEV_ROLE (F4)             │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ STAGE 5 — Observability gate                                    │
│   dashboards imported in Grafana (8.4)                           │
│   alert rules loaded in Prometheus (8.3)                         │
│   Alertmanager routes configured                                 │
│   Loki ingestion verified                                        │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ STAGE 6 — Staging dry-run                                       │
│   npm run verify:deployment  (с учётом F3 — isolated mode)       │
│   npm run docker:build (если docker-deploy)                      │
│   manual smoke: operator UI login, paper trade flow              │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ STAGE 7 — Production rollout (paper-first)                       │
│   infra/docker-compose.prod.yml up -d                            │
│   verify nginx /health                                          │
│   verify metrics на каждом сервисе через docker exec             │
│   confirm: PAPER_DISCOVERY_ENABLED, no MOCK_VENUE_*              │
└─────────────────────────────────────────────────────────────────┘
```

Каждый stage — **gate**. FAIL любого → стоп, разбор, фикс, повтор с этого stage.

### Post-paper backlog (LIVE-READY blockers)

По результатам этого ревью заведены backlog-задачи (отдельная работа, не в этом заходе):

| Finding | Задача |
|---------|--------|
| F1 | Backend service-to-service auth guard (mTLS или HMAC) для live |
| F2 | ✅ `tools/validate-env.sh`: `OPENCLAW_*` → `HERMES_*` rename — **RESOLVED** |
| F2.1 | ✅ `.env.production.example`: `OPENCLAW_*` → `HERMES_*` sync — **RESOLVED** |
| F3 | ✅ `tools/verify-deployment.sh`: режим `VERIFY_MODE=isolated` для prod — **RESOLVED** (+ BFF-fallback для canonical registry) |
| F4 | ✅ `tools/validate-env.sh`: блокирует deploy при `ARBIBOT_DEV_ROLE` (exit 1) — **RESOLVED (сильнее обещанного)**; `ARBIBOT_DEV_ROLE` env-fallback → noop в production — **backlog** |
| F5 | `deployment-readiness-assessment.md`: явная маркировка PAPER vs LIVE |
| F6 | ✅ Alert-каталог: `ArbibotHttpLatencyP99` → `SLOLatencyFastBurn`, `OutboxRelayLag` → `OutboxRelayBacklog`, `ReconciliationOpenMismatches` → `ReconciliationMismatches` — **добавлены в `alerts.yml`** (synced в §8.3, 2026-06-14). ⚠️ Остался backlog: `KafkaPublishFailures` — требует экспорта bridge error counter из `@arbibot/outbox-kafka-bridge`. |

---

## 12. Методология верификации

Этот документ соответствует [`.cursor/rules/verification-methodology.mdc`](../.cursor/rules/verification-methodology.mdc).

### Self-verification чеклист (применён к этому документу)

- [x] Scope фазы: Phase 0–5 + DEX все `done`; новых фич не вводит.
- [x] Single-writer: документ только аудирует, не меняет.
- [x] Reservation-first: проверяется в разделе 7.1.
- [x] State machines: раздел 7.3.
- [x] Контракты: раздел 3 (HTTP/async/bus).
- [x] Стек: TypeScript / NestJS / Fastify / Next.js / Postgres / Redis / Redpanda — без отклонений.
- [x] TODOs: backlog findings явно помечены.
- [x] Audit trail: раздел 4.6.
- [x] Idempotency: раздел 7.4.
- [x] Service boundaries: не нарушены (документация only).

### Подход верификации (для оператора)

1. **До деплоя:** прогнать разделы 1–8 + gate-sequence 0–5.
2. **На staging:** gate-sequence 6.
3. **Перед production:** gate-sequence 7 + sign-off.
4. **После paper-deploy:** набирать статистику (drift, latency, bus health), готовить LIVE-READY gap-closure по findings F1–F5.

### Компромиссы

- Документ длинный (~400 строк), но консолидированный и grep-уемый. Альтернатива — разбить на несколько файлов, потеряв single-source-of-truth.
- Не запускает сами проверки — это gate-чтение. Реальный прогон — следующий шаг оператора.
- Не вводит новые архитектурные паттерны (mTLS, Vault) — только фиксирует их отсутствие как `[LIVE-ONLY]` gap.

---

## 13. Sign-off

| Поле | Значение |
|------|----------|
| Дата проверки | YYYY-MM-DD |
| Режим | PAPER-READY ☐ / LIVE-READY ☐ |
| Gate stages 0–7 пройдены | ☐ |
| Findings F1–F5 рассмотрены | ☐ |
| Ответственный | ____________ |
| Решение | PASS ☐ / PASS w/ warnings ☐ / FAIL ☐ |
| Замечания | ____________ |

---

**Связанные документы для углубления:**
- [`docs/deployment-checklist.md`](deployment-checklist.md)
- [`docs/deployment-guide.md`](deployment-guide.md)
- [`docs/deployment-readiness-assessment.md`](deployment-readiness-assessment.md)
- [`docs/ci-verification-checklist.md`](ci-verification-checklist.md)
- [`docs/security-hardening-guide.md`](security-hardening-guide.md)
- [`docs/security-baseline.md`](security-baseline.md)
- [`docs/observability-tracing.md`](observability-tracing.md)
- [`docs/outbox-inbox.md`](outbox-inbox.md)
- [`docs/reservation-first.md`](reservation-first.md)
- [`docs/state-machines.md`](state-machines.md)
- [`docs/operator-approval-flow.md`](operator-approval-flow.md)
- [`docs/incident-response-playbook.md`](incident-response-playbook.md)
- [`docs/disaster-recovery-plan.md`](disaster-recovery-plan.md)