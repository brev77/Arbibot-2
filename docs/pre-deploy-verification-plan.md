# Pre-Deploy Verification Plan — Arbibot 2

> **Назначение:** пошаговый **исполнительный план** полной проверки кодовой базы перед деплоем.
> Этот документ — **complement** к каноническим DoD (см. ниже), не их замена. Он фокусируется на
> **что именно запускать и в каком порядке**, с явными командами, ожидаемыми результатами и
> ссылками на артефакты. Найденные риски (Critical/High) трекаются отдельно в
> [`docs/TODO.md`](TODO.md) (раздел «Pre-deploy risk tracker»).

**Версия документа:** 1.0 (2026-07-17) — первоначальная редакция после разведки кодовой базы.
**Scope:** paper-first deployment → (после приёмки) live minimal capital.
**Дата последнего прогона:** _(заполняется при каждом запуске — см. раздел «Журнал прогонов»)_

---

## 0. Иерархия документов (что авторитетнее чего)

Этот план **не канон** — он исполнитель. Канонические документы по приоритету:

| # | Документ | Роль |
|---|----------|------|
| 1 | [`docs/paper-deploy-dod.md`](paper-deploy-dod.md) | **Канон PAPER-DEPLOY gate** (D4-A-7-PAPER-SMOKE). Что значит «paper-deploy готов». |
| 2 | [`docs/live-deploy-dod.md`](live-deploy-dod.md) | **Канон LIVE-DEPLOY gate** (D4-C-4-LIVE-SMOKE). Блокеры для live. |
| 3 | [`docs/release-process.md`](release-process.md) | Канон cutting a release (semver, CHANGELOG, git tag). |
| 4 | [`docs/deployment-readiness-assessment.md`](deployment-readiness-assessment.md) | Текущий readiness score (PAPER vs LIVE). |
| 5 | [`docs/deployment-checklist.md`](deployment-checklist.md) | Поэтапный деплой. |
| 6 | [`docs/pre-deploy-review.md`](pre-deploy-review.md) | **SUPERSEDED** исторический consolidated gate (F1–F6 findings). |
| 7 | **`docs/pre-deploy-verification-plan.md`** (этот файл) | **Исполнительный план: что/когда/как запускать.** |

**Правило:** при конфликте — канон (1–5) побеждает. Этот план только уточняет порядок и команды.

---

## 1. Актуальное состояние (snapshot от 2026-07-17)

| Метрика | Канон (AGENTS.md) | **Факт** | Статус |
|---|---|---|---|
| Сервисов `apps/*` | 12 NestJS + web | **12 NestJS + web** | ✅ |
| Пакетов `packages/*` | 9 | **9** | ✅ |
| Build | 21/21 | **22/22** (см. Фазу 1) | ✅ нужно перепроверить |
| Lint | 28/28 | **29/29** (2 warn web — known TanStack Table) | ✅ |
| Tests | 392/392 (27 suites) | **✅ 29/29 пакетов green** (turbo, с кэшем; per-package detectOpenHandles — 0 утечек; messaging 3/3 за 6s, canonical-market 11/11, market-intake 8/8, portfolio 13/13 за 13s каждый — без аномальных времён). Полный no-cache прогон рекомендуется на CI для канонической цифры N/N. | ✅ confirmed |
| Миграции | 001–036 (AGENTS.md устарел) | **001–043** | ✅ больше чем в AGENTS.md |
| Docker prod compose | ❌ (AGENTS.md устарел) | **✅ `infra/docker-compose.prod.yml`** | ✅ |
| CD pipeline | ❌ (AGENTS.md устарел) | **✅ `.github/workflows/cd.yml`** (GHCR build+push, без deploy step) | ✅ с gap (см. M5) |
| `npm audit --omit=dev` | — | **0 vulnerabilities** | ✅ |
| CI security gates | — | **5**: `secret-scan` (blocking), `paper-live-boundary` (blocking), gitleaks, CodeQL, Trivy (13 образов) | ✅ |

**Расхождение с AGENTS.md:** Build 21→22, Lint 28→29, миграции 36→43 — все в **большую** сторону
(функционал вырос). AGENTS.md нужно обновить отдельно.

---

## 2. Категории рисков (summary — полный список в [`TODO.md`](TODO.md))

### 🔴 Critical (блокеры **live**-деплоя; для paper — оставить как есть/выключить)

| ID | Риск | Где | Действие для paper | Действие для live |
|----|------|-----|--------------------|-------------------|
| **C1** | Bridge fee estimation — заглушки (TODO в across + stargate). Реальные деньги при live bridge. | `apps/execution-orchestrator/src/execution/bridge/across-bridge.adapter.ts:395`, `stargate-bridge.adapter.ts:508` | ОК (paper — simulated) | **Реализовать real-time fee ИЛИ disable cross-chain в live** |
| **C2** | ~~Тесты `392/392` не подтверждены локально~~ → **✅ RESOLVED (2026-07-17):** заявление о «SIGTERM + утечках» было **false positive** — артефакт способа запуска `turbo run test -- --detectOpenHandles` (флаги форвардятся в no-op пакеты типа tsconfig, где `node -e` падает на неизвестных CLI-флагах). Per-package прогоны с `--detectOpenHandles` — все PASS, 0 утечек handles. `npm run test` → **29/29 пакетов green**. | — | — |
| **C3** | `audit-service` — 0 unit-тестов (compliance-trail непроверен). | `apps/audit-service/` | ОК (audit append-only, low risk) | **Добавить spec на `audit.service.ts`** |

### 🟠 High (блокеры live; для paper — проверить)

| ID | Риск | Где |
|----|------|-----|
| **H1** | Hardcoded salt в `KeyVaultService` (должен быть per-deploy или KMS). | `packages/nest-platform/.../key-vault.service.ts` |
| **H2** | API key comparison **timing-unsafe** в `HermesAuthGuard` (не constant-time). | `apps/hermes-gateway/.../hermes-auth.guard.ts` |
| **H3** | `config-service/panic.service` без unit-тестов (panic button — деструктивный путь). | `apps/config-service/` |
| **H4** | `token-approve.service` без unit-тестов (ERC-20 approve перед swap — ошибки = потеря средств). | `apps/execution-orchestrator` |
| **H5** | `paper-capital.service` без unit-тестов (резервирование виртуальных средств). | `apps/paper-trading-service` |

### 🟡 Medium (не блокеры; отслеживать)

| ID | Риск |
|----|------|
| **M1** | Dev session secret fallback (fail-closed в prod, но проверить) |
| **M2** | Across `outputAmount = amount` (без учёта мостовой комиссии) |
| **M3** | Native bridge dead address + OP withdrawal correlation |
| **M5** | CD pipeline не имеет deploy step (только build+push в GHCR) — ручной `docker compose pull && up -d` |
| **M6** | Миграции не применяются автоматически при deploy (нет one-shot migrator контейнера) |
| **M7** | TLS сертификаты должны предоставляться извне (`infra/nginx/ssl/` пустой) |
| **M8** | Backup стратегия не автоматизирована (нет pg_dump cron/WAL archiving в compose) |
| **M9** | `node_exporter` отсутствует → `DiskSpaceLow` alert будет без данных |
| **M10** | Hermes Agent в compose — это шаблон на `python:3.11-slim` (публичного образа нет) |

### 🟢 Low (cosmetic / tech debt)

L1 test mnemonic allowlist (правильно исключён) · L2 `console.error` в startup · L3 `PRIVATE_KEY_ENCRYPTION_KEY` не в validator · L4 Prettier не настроен · L5 Web UI ~3% test coverage · L6 крупные файлы execution-orchestrator (native-bridge 928 LOC) · L7 конфликт порта 3000 Next.js vs risk-service (только локально).

**⚠️ M4 снят:** корневые `*.log` файлы (`build-*.log`, `logs_*.log`, `test-*.log`) уже исключены через `*.log` в `.gitignore` — это локальные артефакты, в git не попадают.

---

## 3. Исполнительный план — 9 фаз

> Каждая фаза — **gate**. FAIL → стоп, разбор, фикс, повтор с этой фазы.
> Время — оценочное на машине разработчика; CI обычно быстрее.

### Фаза 0 — Pre-flight (Go/No-Go)  ⏱ ~5 мин

**Цель:** убедиться, что нет причин не начинать проверку.

```bash
# 0.1 Working tree чистый
cd C:/Coding/Arbibot-2
git status --porcelain                         # ожидание: пусто

# 0.2 На свежем main
git fetch origin && git log --oneline origin/main -5

# 0.3 .env НЕ в git (должно вывести "NOT TRACKED")
git ls-files --error-unmatch .env 2>/dev/null && echo "КРИТИЧНО: .env в git!" || echo "OK: .env NOT TRACKED"

# 0.4 Локальные лог-артефакты (уже в .gitignore — не в репо, но можно почистить локально)
ls *.log 2>/dev/null | wc -l                    # информативно
```

**Go-критерии:**
- [ ] Working tree clean (или только预期的 doc-изменения)
- [ ] На свежем `origin/main`
- [ ] `.env` не отслеживается git
- [ ] Node 22+ (`node -v`)

---

### Фаза 1 — Статическая валидация кода  ⏱ ~10 мин (с turbo cache)

**Цель:** формальные метрики green.

```bash
# 1.1 Установить зависимости (idempotent)
npm ci

# 1.2 Lint (ожидание: 29/29 пакетов green, 0 errors, 2 warn в web)
npm run lint 2>&1 | tee /tmp/lint-predeploy.log

# 1.3 Build (ожидание: 22/22 пакетов green)
npm run build 2>&1 | tee /tmp/build-predeploy.log

# 1.4 Тесты — canonical (без форвардинга флагов в no-op пакеты)
npm run test 2>&1 | tee /tmp/test-predeploy.log
#   ⚠️ НЕ использовать `npm run test -- --detectOpenHandles` — turbo форвардит
#   флаги во ВСЕ пакеты, включая no-op (`node -e "process.exit(0)"` в tsconfig/contracts),
#   где node CLI флаги невалидны → turbo падает. Диагностика утечек handles — per-package:
#   npx jest --detectOpenHandles -w @arbibot/messaging
#   npx jest --detectOpenHandles --logHeapUsage path/to/slow.spec.ts
```

**Static guards (быстрые):**
```bash
# 1.5 Key leakage guard (K1/K2 из dex-security SKILL) — должен PASS
npm run ci:key-leakage

# 1.6 Paper/live import-graph boundary (PL.1/PL.2) — должен PASS
bash tools/ci-paper-live-boundary.sh
```

**Критерии PASS Фазы 1:**
- [ ] Lint 0 errors (warn web — known, допустимо)
- [ ] Build 22/22
- [ ] Tests N/N (зафиксировать число в Журнале прогонов; если падает — открыть task C2)
- [ ] `ci:key-leakage` PASS
- [ ] `ci-paper-live-boundary.sh` PASS

---

### Фаза 2 — Безопасность капитала и ключей  ⏱ ~2 ч

**Цель:** никаких векторов потери средств/ключей.

**Скиллы Cursor (запустить вручную в IDE):**
- `/architecture-guard` — границы single-writer, paper/live изоляция
- `/dex-security` — K/T/B/C/A threat model
- `/backend-review` — risk/capital/execution/audit

**Чек-лист проверки (файл:вывод):**
- [ ] **H1 закрыть или отложить:** `KeyVaultService` — проверить salt. Hardcoded → backlog (live only).
- [x] **H2:** `HermesAuthGuard` — заменён `Array.includes` на constant-time `safeKeyEquals` (`crypto.timingSafeEqual` с length-guarded dummy compare, без early-exit), spec расширен до 12 тестов / 100% coverage — commit pending.
- [ ] `decryptPrivateKey` используется **только** в `KeyVaultService`/`WalletManagerService` (`grep -rn "decryptPrivateKey" apps/ packages/`).
- [ ] Нет `console.log`/`logger.*` рядом с `privateKey`/`mnemonic`/`signingKey` (K1 из dex-security SKILL).
- [ ] Нет raw 64-hex литералов в production коде (K2).
- [ ] **C1:** real-time fee estimation для Across/Stargate **ИЛИ** убедиться что cross-chain выключен в live config (`dex.live.killSwitch=true`, `dex.live.crossChainEnabled=false` если есть).
- [ ] `ci-paper-live-boundary.sh` — paper-trading не импортирует live capital/execution.
- [ ] **Config guards safe-by-default:** миграция `035` — `dex.limits.killSwitch=false` (внимание: в config терминология может отличаться — проверить seed), `dex.live.dryRunMode=true`, `dex.limits.maxNotionalPerTradeUsd=500`.
- [ ] **Prod env НЕ содержит:** `ARBIBOT_DEV_ROLE`, `ARBIBOT_DEV_OPERATOR_ID` (блокируется `validate-env.sh`, см. F4 в [`pre-deploy-review.md`](pre-deploy-review.md)).
- [ ] **Prod env содержит и не-дефолтные:** `OPERATOR_SESSION_SECRET`, `OPERATOR_BOOTSTRAP_TOKEN`, `PRIVATE_KEY_ENCRYPTION_KEY`, `ARBIBOT_SERVICE_AUTH_SECRET`, `HERMES_API_KEYS`, `RISK_POLICY_JOB_TRIGGER_TOKEN`.
- [ ] `CORS_ORIGINS` — явные домены (не `*`).
- [ ] Wallet mnemonic — в Vault / encrypted DB (`wallet_keys`, миграция 042), НЕ в `.env`.

**Key rotation drill (LIVE-READY only):** выполнить [`docs/key-rotation-runbook.md`](key-rotation-runbook.md) на staging.

---

### Фаза 3 — Инфраструктура и Docker  ⏱ ~3 ч

**Цель:** образы собираются, compose поднимается, health-проверки отвечают.

```bash
# 3.1 Локальный dev-stack (для smoke; поднимает Postgres:15432, Redis, Redpanda)
npm run dev:stack
docker compose -f infra/docker-compose.dev.yml ps        # все healthy

# 3.2 Сборка production-образов для всех 12 Nest + web
bash tools/docker-build-all.sh                            # или docker:build

# 3.3 Production compose — валидация синтаксиса (без запуска)
POSTGRES_PASSWORD=dummy GRAFANA_ADMIN_PASSWORD=dummy \
  docker compose -f infra/docker-compose.prod.yml config > /dev/null && echo "config OK"

# 3.4 Production compose — запуск (на staging/vagrant)
POSTGRES_PASSWORD=<vault> GRAFANA_ADMIN_PASSWORD=<vault> \
  docker compose -f infra/docker-compose.prod.yml up -d
docker compose -f infra/docker-compose.prod.yml ps        # все 22 контейнера Up/healthy

# 3.5 Health probes (D4-A-5-PROBES)
for port in 3000 3010 3011 3012 3013 3014 3015 3016 3017 3018 3019 3020; do
  echo -n "port $port live: "; curl -s -o /dev/null -w "%{http_code}\n" http://localhost:$port/health/live
  echo -n "port $port ready: "; curl -s -o /dev/null -w "%{http_code}\n" http://localhost:$port/health/ready
done
# Ожидание: 200/200 для каждого порта

# 3.6 Service-specific probes
curl -fsS http://localhost:3015/health/degradation       # market-intake
curl -fsS http://localhost:3012/health/dex               # execution-orchestrator
curl -fsS http://localhost:3012/health/bridges
curl -fsS http://localhost:3020/health/operator-bff      # hermes-gateway

# 3.7 Verify-deployment (D4-A-7-PAPER-SMOKE использует VERIFY_MODE=isolated)
VERIFY_MODE=isolated npm run verify:deployment
```

**Проверить вручную:**
- [ ] `Dockerfile.nest` / `Dockerfile.web` — non-root (user 1001), `NODE_ENV=production`, multistage, `node:22-alpine`.
- [ ] Resource limits в compose соответствуют [`docs/capacity-planning.md`](capacity-planning.md).
- [ ] Network isolation: `arbibot-backend` (bridge, **без** `internal: true` — нюанс N2 в [`pre-deploy-review.md`](pre-deploy-review.md)), `arbibot-observability` (`internal: true`).
- [ ] Только `nginx:80/443` в `ports:` у backend-сервисов — остальные без `ports:`. Проверить override-файлы.
- [ ] PgBouncer transaction pool порт 6432.
- [ ] nginx TLS termination (**M7:** предоставить сертификаты Let's Encrypt или `tools/generate-tls-certs.sh` для self-signed).
- [ ] Backup service — **M8:** добавить pg_dump cron (см. [`docs/disaster-recovery-plan.md`](disaster-recovery-plan.md), [`tools/backup-postgres.sh`](../tools/backup-postgres.sh)).

---

### Фаза 4 — Миграции БД  ⏱ ~1 ч

**Цель:** clean DB → все 43 миграции → forward-only guaranteed.

```bash
# 4.1 На ЧИСТОЙ staging БД (с нуля) — самый надёжный способ
dropdb arbibot_staging && createdb arbibot_staging
DATABASE_URL=postgres://arbibot:***@host:15432/arbibot_staging npm run db:migrate

# 4.2 Верификация всех 43 (ожидание: все 001-043 в schema_migrations)
npm run db:verify-migrations:all

# 4.3 Idempotency — повторное применение молчит (IF NOT EXISTS)
DATABASE_URL=... npm run db:migrate  # второй прогон — 0 rows affected

# 4.4 (Опционально) Explicit verify конкретных миграций
node tools/verify-migrations-applied.mjs 030 031 035 036 042 043
```

**Критичные миграции — ручной review (read SQL):**
- [ ] **024** — фикс `rollback_configuration()` (PL/pgSQL).
- [ ] **033** — `on_chain_transactions`, `wallet_states`, `dex_pools`, `approvals`.
- [ ] **034** — `on_chain_transactions.leg_id` bigint→uuid (FK alignment).
- [ ] **035** — seed `dex.limits` + `dex.live` (проверить safe-by-default).
- [ ] **036** — DEX-2 crosschain (`bridge_transfers`, recon tables).
- [ ] **037** — DROP+recreate `get_effective_config_value()` (PostgreSQL 42804 фикс).
- [ ] **042** — `wallet_keys` (encrypted at rest).
- [ ] **043** — bridge finality (D4-B-5-BRIDGE L5).

**Rollback стратегия (forward-only):** перечитать [`docs/dex-rollback-strategy.md`](dex-rollback-strategy.md).
L1 (seed DELETE) / L2 (config disable) обратимы. L3 (DDL drop) теряет данные — backup перед apply.

---

### Фаза 5 — E2E / Integration smoke  ⏱ ~2 ч

**Цель:** реальные сценарии end-to-end проходят на staging.

```bash
# 5.1 CI wrappers (поднимают Postgres service container + нужные сервисы автоматически)
npm run ci:e2e-phase2                            # HTTP цепочка controlled execution
npm run ci:e2e-phase2-watchlist-route-scoring    # policy writers
npm run ci:e2e-phase3-paper-promotion            # outbox → paper
npm run ci:e2e-phase3-paper-discovery            # worker + metrics
npm run ci:e2e-phase4-tier-routing               # intake throttle
npm run ci:bus-smoke                             # outbox-kafka-bridge + Redpanda

# 5.2 DEX multi-chain (требует testnet или paper-mainnet)
node tools/e2e-dex2-multichain.mjs               # snapshot→opp→risk→capital→arm→legs→fills

# 5.3 Drill #1 (paper incident) — после первой недели в paper
npm run drill:1
```

**DoD-чеклисты (канон):**
- [ ] [`docs/paper-deploy-dod.md`](paper-deploy-dod.md) — все пункты для paper deployment.
- [ ] [`docs/live-deploy-dod.md`](live-deploy-dod.md) — для live (после paper-приёмки; Gate 3 testnet soak).
- [ ] [`docs/deployment-checklist.md`](deployment-checklist.md) — operator checklist.

---

### Фаза 6 — Observability verification  ⏱ ~1 ч

**Цель:** метрики/логи/алерты идут в Prometheus/Loki/Alertmanager.

```bash
# 6.1 Метрики — каждый сервис экспортирует (D4-A-5-PROBES продолжение)
for port in 3000 3010 3011 3012 3013 3014 3015 3016 3017 3018 3019 3020; do
  curl -fsS "http://localhost:$port/metrics" | head -3 && echo " ← port $port"
done

# 6.2 Prometheus targets — все UP
open http://localhost:9090/targets                # ожидание: 12/12 NestJS UP

# 6.3 Grafana — 7 dashboards загружены
open http://localhost:3001                        # admin / GRAFANA_ADMIN_PASSWORD

# 6.4 Loki — логи идут (NDJSON парсится)
curl -G -s "http://localhost:3100/loki/api/v1/query_range" \
  --data-urlencode 'query={service="risk-service"}' \
  --data-urlencode 'limit=5' | jq '.data.result | length'

# 6.5 Alertmanager — config загружен, receivers сконфигурированы
curl http://localhost:9093/api/v2/status | jq '.data.versionInfo.version'
```

**Проверить alerts по [`infra/prometheus/alerts.yml`](../infra/prometheus/alerts.yml) (17 правил, 9 групп):**
- [ ] `ServiceDown` (2m) — триггернется при остановке сервиса.
- [ ] `PaperDriftBpsHigh` (50bps) / `PaperDriftBpsSustainedHigh` (30bps × 10m) — критично для paper-валидации.
- [ ] `DEXUnhealthy` / `DEXRPCDegraded` / `DEXLiveHaltActive` — DEX health + kill switch.
- [ ] `CapitalExhaustion` (<$1000) — критично.
- [ ] `ExecutionPlanStuck` (>10m).
- [ ] `ReconciliationMismatches` (>5/15m).
- [ ] `slo_burn_rate` (4 правила: SLOFastBurnCritical, SLOSlowBurnCritical, SLOMediumBurnWarning, SLOLatencyFastBurn).
- [ ] **Минимум один paging receiver:** `PAGERDUTY_ROUTING_KEY` ИЛИ `SLACK_WEBHOOK_URL` установлен.
- [ ] **M9:** добавить `node_exporter` ИЛИ убрать `DiskSpaceLow` alert (требует `node_filesystem_avail_bytes`).

---

### Фаза 7 — Paper-first валидация (канон DoD)  ⏱ ~1 неделя

**Цель:** сквозной тест всего стека **без реальных потерь**, накопление статистики.

**Авторитет:** [`docs/paper-deploy-dod.md`](paper-deploy-dod.md) (D4-A-7-PAPER-SMOKE).
**Последовательность (из [`DEVELOPMENT_PLAN.md`](../.cursor/plans/DEVELOPMENT_PLAN.md), «Операционная последовательность первичного запуска»):**

1. **Paper deploy** — `DEX_LIVE_ENABLED=false`, `PAPER_DEX_MAINNET_ENABLED=true`, `DEX_LIVE_KILL_SWITCH=true`.
2. **Smoke data flow:** market-intake → opportunity → risk → capital → paper-execution → observability/UI.
3. **Накопление статистики:** drift gauges, promotion candidates, route scoring (≥ 24–72 ч).
4. **Drift validation:** `PaperDriftBpsSustainedHigh` alert **НЕ** должен срабатывать в steady-state.
5. **Operator UI walkthrough:** `/dashboard`, `/paper`, `/tokens`, `/execution`, `/settings`, `/HERMES`, `/incidents`.
6. **Reconciliation cycles:** `CrossChainReconWorker` гоняет циклы, mismatches = 0.
7. **HERMES Agent:** Telegram-бот отвечает на NL запросы, safe-mode-check, daily-report cron.
8. **Promotion candidates:** reviewed/approved по [`docs/paper-promotion-quality-criteria.md`](paper-promotion-quality-criteria.md).
9. **Backup/restore drill:** [`docs/disaster-recovery-plan.md`](disaster-recovery-plan.md) — restore из pg_dump.

**Приёмка paper → go-live decision:** все alerts молчат, drift < 30bps, P95 latency < 500ms, 0 unreconciled mismatches.

---

### Фаза 8 — Live go-live (минимальный капитал)  ⏱ после приёмки paper

**Цель:** включить live с минимальными лимитами. **Авторитет:** [`docs/live-deploy-dod.md`](live-deploy-dod.md).

**Перед переключением — ВСЕ Critical/High риски закрыты:**
- [ ] **C1** bridge fees real-time (across/stargate) — иначе disable bridges в live.
- [ ] **C2** тесты N/N подтверждены на CI, нет утечек handles.
- [ ] **C3** audit-service имеет unit-тесты.
- [ ] **H1** salt per-deploy / KMS.
- [x] **H2** constant-time API key compare (safeKeyEquals via crypto.timingSafeEqual, 12 tests / 100% — commit pending).
- [x] **H3** panic.service покрыт тестами (panic.service.spec.ts, 14 tests, 100% all metrics — commit pending).
- [ ] **H4** token-approve.service покрыт тестами.
- [x] **H5** paper-capital.service покрыт тестами (paper-capital.service.spec.ts, 10 tests, 96.66% stmts / 100% branch — commit pending).

**Switch sequence (см. [`docs/live-deploy-dod.md`](live-deploy-dod.md) Gate 4):**
1. Backup БД (`pg_dump` через [`tools/backup-postgres.sh`](../tools/backup-postgres.sh)).
2. Config change через config-service: `dex.live.killSwitch=false`, `dex.live.dryRunMode=false`, `DEX_LIVE_ENABLED=true` — operator-approved, audited.
3. Установить `dex.limits.maxNotionalPerTradeUsd=500` (минимальный капитал).
4. Monitor drift/P&L/reconciliation первый час (через Grafana + Alertmanager).
5. Panic-button доступен: `npm run panic:stop` / `npm run panic:recover` (см. [`docs/HERMES-safe-mode-runbook.md`](HERMES-safe-mode-runbook.md)).

---

## 4. Журнал прогонов

Каждый прогон плана — запись сюда (дата, ветка/commit, результат по фазам).

| Дата | Commit | Фаза 0 | Фаза 1 (lint/build/test) | Фаза 2 (security) | Фаза 3 (docker) | Фаза 4 (migrations) | Фаза 5 (e2e) | Фаза 6 (observability) | Фаза 7 (paper) | Фаза 8 (live) | Оператор | Решение |
|------|--------|--------|--------------------------|-------------------|-----------------|---------------------|--------------|------------------------|----------------|---------------|----------|---------|
| 2026-07-17 | `4e8708a` | 🟢 | 🟢 29/29 lint · 🟢 22/22 build · 🟢 tests 29/29 pkgs green (с кэшем); detectOpenHandles per-pkg — 0 утечек; static guards: 🟢 key-leakage, 🟢 paper-live-boundary | ☐ | ☐ | 🟢 verified: 43 files, 001–043, 0 prefix collisions | ☐ | ☐ | ☐ | ☐ | _pre-deploy разведка_ | partial: Phase 0+1 PASS, остальные — операционные (требуют prod env / Docker / staging) |
| _YYYY-MM-DD_ | _sha_ | ☐ | ☐ / ☐ / ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | _name_ | PASS ☐ / w/warn ☐ / FAIL ☐ |

**Легенда:** ☐ = не запускалось · 🟢 = PASS · 🟡 = PASS w/ warnings · 🔴 = FAIL.

---

## 5. Канон «must-pass» (если времени мало)

Если времени мало — минимум (из [`pre-deploy-review.md`](pre-deploy-review.md) §10):

1. `npm run lint && npm run build && npm run test` — gate.
2. `npm run db:migrate && npm run db:verify-migrations:all` — схема.
3. E2E critical path: `e2e:phase1-foundation` + `e2e:phase2-controlled-execution` + `e2e:phase3-paper-promotion`.
4. **RBAC + destructive actions** (Фаза 2 чек-лист).
5. **Outbox/inbox + bus-smoke** (`npm run ci:bus-smoke`).
6. **Secrets/env/headers/logs** (Фаза 2).
7. **Reconciliation + rollback scenarios** (Фаза 5 + [`docs/dex-rollback-strategy.md`](dex-rollback-strategy.md)).

Остальные фазы — «желательно», но не блокер paper-deploy.

---

## 6. Cross-references (карта документов)

**Канон DoD:** [`paper-deploy-dod.md`](paper-deploy-dod.md), [`live-deploy-dod.md`](live-deploy-dod.md), [`release-process.md`](release-process.md).
**Risk tracker:** [`TODO.md`](TODO.md) → раздел «Pre-deploy risk tracker» (C1–C3, H1–H5, M1–M10, L1–L7).
**Методология:** [`.cursor/rules/verification-methodology.mdc`](../.cursor/rules/verification-methodology.mdc).
**Исторический gate:** [`pre-deploy-review.md`](pre-deploy-review.md) (SUPERSEDED, F1–F6 findings).
**Runbooks:** [`incident-response-playbook.md`](incident-response-playbook.md), [`disaster-recovery-plan.md`](disaster-recovery-plan.md), [`reconciliation-p0-procedures.md`](reconciliation-p0-procedures.md), [`dex-runbook-bridge.md`](dex-runbook-bridge.md), [`dex-rollback-strategy.md`](dex-rollback-strategy.md), [`key-rotation-runbook.md`](key-rotation-runbook.md), [`HERMES-safe-mode-runbook.md`](HERMES-safe-mode-runbook.md), [`HERMES-gateway-runbook.md`](HERMES-gateway-runbook.md).
**Архитектура/домен:** [`../CONTEXT.md`](../CONTEXT.md), [`../AGENTS.md`](../AGENTS.md), [`services.md`](services.md).

---

## 7. Self-verification чеклист (применён к этому документу)

- [x] **Scope:** paper-first → live; не вводит новых фич, только план верификации.
- [x] **Не дублирует канон:** явно ссылается на `paper-deploy-dod.md`/`live-deploy-dod.md` как на авторитет.
- [x] **Single-writer:** документация only, не меняет код.
- [x] **Reservation-first / state machines / idempotency:** проверяются в Фазах 2 + 5 через ссылки на канон.
- [x] **Audit trail:** Фаза 2 чек-лист (audit mutations).
- [x] **Service boundaries:** не нарушены.
- [x] **Traceable:** каждый риск имеет ID (C/H/M/L), каждая фаза — gate с критериями PASS.
- [x] **Журнал прогонов:** есть (раздел 4) — обновляется при каждом запуске.
