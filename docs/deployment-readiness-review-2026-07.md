# Deployment Readiness Review — 2026-07

> ⚠️ **SUPERSEDED (2026-07-17):** все P3–P8 и L1–L8 находки этого ревью закрыты фазой **D4 deploy-readiness** (Plan 4, коммиты `bad30f9`..`df2177a`, 2026-07-12→16).
> Актуальные процедуры деплоя — [`paper-deploy-dod.md`](paper-deploy-dod.md) (paper) / [`live-deploy-dod.md`](live-deploy-dod.md) (live) / [`release-process.md`](release-process.md).
> Этот документ сохранён для истории аудита.

- **Дата ревью:** 2026-07-11
- **Объект:** Arbibot 2 monorepo (ветка `main`, коммит `622aeac`)
- **Метод:** статический аудит артефактов деплоя (Dockerfiles, compose, CI/CD, миграции, observability, runbooks, код управления ключами/капиталом, auth/RBAC)
- **Назначение:** оценка готовности к первичному деплою (paper-first → live minimal capital), согласно операционной последовательности, зафиксированной в `DEVELOPMENT_PLAN.md`
- **Статус ревью:** аналитический отчёт, изменения в код не вносились

---

## 1. Итоговый вердикт

| Режим | Готовность | Обоснование |
|---|---|---|
| **Paper trading** | 🟡 Готов с условиями (~80%) | Контейнеризация, prod compose-стек, CD в GHCR, миграции, observability — есть. Блокируют: отсутствие операторского auth, нерабочая процедура restore, placeholder'ы paging, ручное применение миграций. |
| **Live (реальный капитал)** | 🔴 НЕ готов | Несколько капитально-критичных контролей **существуют только в документации, но не в коде**: kill-switch фиктивен, агрегатный ceiling capital-service отсутствует, bridge-адаптеры без подтверждения финальности, `dex.limits`/`dex.live` не потребляются бэкендом. |

Это согласуется с собственной самооценкой проекта `docs/deployment-readiness-assessment.md` («100/100 PAPER-ready, not LIVE-ready») — она **точна**, а в ряде мест разрыв между доками и кодом шире, чем утверждают документы.

Код к paper — в основном готов; к live — нет. Это соответствует заявленному в `AGENTS.md` порядку запуска: paper-first → после приёмки live с минимальным капиталом.

---

## 2. Сильные стороны (готовые к использованию)

- **Контейнеризация production-класса.** `infra/docker/Dockerfile.nest` + `Dockerfile.web` — multi-stage, turbo prune, non-root (`arbibot:1001`), с HEALTHCHECK. Один параметризованный Dockerfile покрывает все 12 Nest-сервисов.
- **`infra/docker-compose.prod.yml`** — полный стек на ~22 контейнера: Postgres 16 + PgBouncer, Redis 7, Redpanda, 12 Nest-сервисов + `apps/web` + `hermes-gateway`, Prometheus/Grafana/Loki/Promtail/Alertmanager, nginx с TLS-терминацией. Resource limits, `depends_on: service_healthy`, сетевая изоляция (`arbibot-backend` + `arbibot-observability` internal), `restart: unless-stopped`, named volumes, required-env (`POSTGRES_PASSWORD: ?Set ...`).
- **CD-пайплайн.** `.github/workflows/cd.yml` собирает и пушит все 13 образов в GHCR (теги `latest` + SHA).
- **Пайплайн безопасности.** `.github/workflows/security.yml` — npm-audit, dependency-review (`fail-on-severity: moderate`), CodeQL (`security-extended`), gitleaks (по всей истории), Trivy (13 образов), Checkov (IaC).
- **Observability.** 7 Grafana-дашбордов (`infra/grafana/dashboards/`), 17 alert-правил в `infra/prometheus/alerts.yml` (включая SRE multi-window burn-rate для SLO 99.9%), recording rules для paper discovery/drift, OpenTelemetry (`packages/nest-platform/src/otel.ts`, off-by-default через `OTEL_EXPORTER_OTLP_ENDPOINT`), `/metrics` на всех 12 бэкенд-сервисах (`installMetricsOnFastify`).
- **Runbooks и операционные доки (12+):** incident-response playbook (SEV-1..4, SLA), DR-план (RTO 4h / RPO 24h), `docs/drill-1-paper-incident.md`, deployment-guide/checklist, DEX runbooks по цепочкам, key-rotation, intake-degradation.
- **Безопасность репозитория и зависимостей — самая сильная область.** `.github/dependabot.yml` (single-root npm, grouped minor/patch), gitleaks по всей истории git, **захардкоженных ключей/мнемоник в закоммиченных `.ts` не обнаружено** (исключая `*.spec.ts`/`*.d.ts`), `.gitignore` покрывает `.env`, `dist`, `graphify-out`, `infra/nginx/ssl/*.pem`, `backups/`.
- **Резервирование capital-service** (`apps/capital-service/src/capital/capital.service.ts`): `SELECT ... FOR UPDATE` (`pessimistic_write`), idempotent release, reservation + outbox в одной DB-транзакции — на уровне отдельной reservation сделано корректно.

---

## 3. 🔴 Критические блокеры для LIVE (капитал/ключи)

> Каждый из этих пунктов — случай, когда документация описывает контроль, которого **нет в коде**. Для системы с реальными деньгами — прямой путь к потере капитала.

### L1. Kill-switch не существует в коде
- `docs/dex-rollback-strategy.md`, `docs/deployment-readiness-assessment.md`, `docs/security-hardening-guide.md` утверждают, что execution-orchestrator проверяет `dex.limits.killSwitch` / `DEX_LIVE_KILL_SWITCH` перед DEX-исполнением.
- **Grep `killSwitch` / `DEX_LIVE_KILL_SWITCH` по всему бэкенд-коду (`apps/`, `packages/`) возвращает 0 совпадений.**
- Переключатель в UI не останавливает бэкенд. Это ровно угроза **C2 (🔴 critical)** из собственного threat-model проекта (`.cursor/skills/dex-security-and-capital-safety/references/threat-model.md`).

### L2. `dex.limits` / `dex.live` не потребляются бэкендом
- Миграция `035_dex_live_limits_seed.sql` сеет безопасные дефолты (`maxNotionalPerTradeUsd:500`, `requireTwoPersonApproval:true`, `liveEnabled:false`, `dryRunMode:true`).
- Но эти ключи читает **только фронтенд** (`apps/web/.../dex-config-types.ts`, `use-dex-config.ts`).
- `DexRiskPolicyService` (`apps/execution-orchestrator/src/execution/risk/dex-risk-policy.service.ts`) использует **хардкод** (`maxPositionSizeUsd:10000`, `maxDailyVolumeUsd:100000`) с комментарием `// TODO: integrate with config-service for dynamic config` и читает только env (`DEX_MAX_*`).
- **Главное: `DexRiskPolicyService.evaluateTrade()` не вызывается ни одним сервисом** (зарегистрирован в `execution.module.ts`, но ни один потребитель его не инжектит). Ни один live-leg не проходит через risk-gate.

### L3. Нет агрегатного ceiling по капиталу (угроза C1)
- `capital.service.ts` делает `FOR UPDATE` на отдельную reservation, но **не проверяет `SUM(active reservations + open positions) ≤ ceiling`** — нет защиты от C1-race.
- Трекер дневного оборота в `DexRiskPolicyService` — in-memory `Map`, **сбрасывается при рестарте** процесса → дневной лимит фактически не enforced.
- Не найдено кода в execution-orchestrator, который assert'ит активную reservation перед broadcast'ом live-leg (C1.2).

### L4. Управление ключами — software-only, in-memory
- `packages/nest-platform/src/vault/key-vault.service.ts`: AES-256-GCM криптографически корректен (random IV, auth tag, fail-fast при отсутствии `PRIVATE_KEY_ENCRYPTION_KEY`).
- НО: ключи хранятся в `private encryptedKeys = new Map()` с комментарием «в проде будет в БД». Нет HSM/KMS, Vault **не интегрирован** (только `docs/vault-integration-guide.md`).
- `WalletManagerService` кэширует расшифрованный `ethers.Wallet` в `walletCache` **на всё время жизни процесса** — нарушает K1.2 (минимальный lifetime plaintext).
- `PRIVATE_KEY_ENCRYPTION_KEY` **даже не внесён в `.env.production.example`** → оператор может выкатиться без него (упадёт fail-fast, но сам факт пропуска сигнализирует, что live-path не упражнялся).

### L5. Bridge-адаптеры без логики подтверждения финальности
- В `apps/execution-orchestrator/src/bridge` **нет `.wait()` / `confirmations` / `receipt`** (grep пустой).
- Защиты **B1** (idempotent claim) и **B3** (chain-specific finality, напр. Ethereum 12, Optimism 2000+) задокументированы в `docs/dex-runbook-bridge.md`, но **не реализованы в адаптерах** (Across/Stargate/Native).

### L6. mTLS / service-to-service auth не enforce'ится
- `ServiceAuthModule` (HMAC, `packages/nest-platform/src/service-auth/fastify-guard.ts`) есть, но opt-in через `ARBIBOT_SERVICE_AUTH_ENABLED=true`. В `.env.production.example` **выключен**.
- Любой контейнер в сети `arbibot-backend` может вызывать любой сервис без auth. Это finding **F1 (🔴)** в `docs/pre-deploy-review.md`.

### L7. `secret-scan` CI-джоб не блокирующий
- В `.github/workflows/ci.yml` джоб `secret-scan` (`npm run ci:key-leakage`) идёт с `continue-on-error: true`. Регрессия по утечке ключа **не остановит merge**.

### L8. Двух-person approval не enforced
- `apps/web/components/domain/destructive-operator-action.tsx` — single-operator typed-phrase («CONFIRM»), а не two-person rule.
- `requireTwoPersonApproval:true` из миграции 035 **не проверяется в бэкенде**.
- Approval чисто фронтендовый — прямой выз API обходит контроль.

---

## 4. 🟠 Блокеры для PAPER deploy (закрыть до выкатки)

### P1. Операторский auth в `apps/web` отсутствует
- Роль читается из **неподписанной** куки `arbibot_role` (viewer/operator/admin) в `apps/web/middleware.ts` и `apps/web/lib/operator-session.ts`.
- Нет JWT, логина, session-store, IdP (`jsonwebtoken`, `iron-session`, `next-auth`, `jose` — grep пустой).
- `ARBIBOT_DEV_ROLE` в prod правильно отключён (`NODE_ENV !== 'production'` guard), и `tools/validate-env.sh` блокирует его в prod `.env` — это корректно.
- **НО сама кука — bearer-токен без выдачи/проверки.** Любой, кто выставит `arbibot_role=admin` (XSS, misconfig reverse-proxy, shared machine), становится админом. Защита = **только сетевой доступ** (nginx). При любом не-localhost размещении недопустимо.

### P2. Paging не настроен
- В `infra/alertmanager/alertmanager.yml` все receiver'ы указывают на `http://localhost:5001/alerts/*` — несуществующий placeholder-сервис.
- Slack/PagerDuty/Telegram **закомментированы**. Единственный функциональный receiver → reconciliation-service (DB → UI `/incidents`).
- В проде как есть — **никто не получает страниц**; оператор должен сам смотреть дашборд. Paging из `docs/observability-tracing.md` (arbibot-critical schedule, 5-мин SLA) задокументирован, но не подключён.

### P3. Процедура restore сломана
- `docs/deployment-guide.md:648` и `docs/deployment-checklist.md:138` учат: `bash tools/backup-postgres.sh restore /path/to/backup.sql`.
- **У `tools/backup-postgres.sh` нет restore-аргумента** (restore делается вручную `gunzip -c ... | psql`, что описано только в комментарии хедера скрипта).
- `docs/disaster-recovery-plan.md:172` ссылается на `infra/postgres/migrations/rollback/036_rollback.sql` — **такого каталога и файла не существует**.
- Бэкап (`tools/backup-postgres.sh`, `pg_dump` + 30-дневная ротация; S3 upload закомментирован) делается; восстановление — нет. `db:restore` npm-скрипта нет.

### P4. Нет структурированного логирования
- Pino/winston/nestjs-pins отсутствуют (grep `package.json` пустой). Используется обёртка Nest `Logger` + `withCorrelation()` (`packages/nest-platform/src/structured-logger.ts`) — plain text.
- Loki + Promtail есть в стеке, но глотают неструктурированный текст. JSON-pipeline нет (признано в `docs/observability-baseline.md`).

### P5. Нет версионирования релизов
- Нет `CHANGELOG.md`, нет git-тегов (`git tag` пусто), нет поля `version` в корневом `package.json` (`private: true`).
- Образы тегируются по commit SHA + `latest`. Нет release-process doc, semver, release notes.
- Следствие: аудит-трейл изменений и откат «на прошлый релиз» затруднены.

### P6. Нет единой «красной кнопки» (emergency stop)
- Safe-mode HERMES (`apps/hermes-gateway/src/hermes/safe-mode.service.ts`) — **баннер-сигнал, не тормоз** (явно в `docs/hermes-safe-mode-runbook.md:18`: «does not automatically halt execution or capital services»).
- Экстренная остановка = многошаговое редактирование `.env` kill-switch'ей (`DEX_LIVE_KILL_SWITCH`, `PAPER_DEX_MAINNET_ENABLED`, `PAPER_DISCOVERY_ENABLED`, …) + `docker compose restart`. Нет единого panic-button.

### P7. Миграции применяются вручную
- `cd.yml` только build + push образов; нет init-контейнера, хука в `infra/docker/entrypoint.nest.sh` (только `exec node "${ENTRY}"`) или шага CD для `db:migrate`.
- Оператор должен сам гонять `npm run db:migrate` против prod-БД (документировано в `docs/deployment-guide.md §7`).
- **Коллизия версий:** два файла с префиксом `037_` (`037_alertmanager_incidents.sql` и `037_fix_get_effective_config_value.sql`) → недетерминированный порядок применения (`tools/db-migrate.mjs` применяет в лексическом порядке).

### P8. Нет `/ready` vs `/live`
- HEALTHCHECK `Dockerfile.nest` и пробы бьют в `/metrics` — это доказывает, что процесс жив, но **не что он готов обслуживать** (нет проверки DB/Redis/Kafka).
- Отдельный `/health` есть только на `hermes-gateway` и `apps/web` (`/api/health`); на остальных 11 сервисах его нет.

### P9. Сертификаты TLS не поставляются
- `infra/nginx/ssl/` содержит только `.gitkeep`. Operator должен сам класть `fullchain.pem` + `privkey.pem`.
- Let's Encrypt / cert-manager не подключены (есть только `tools/generate-tls-certs.sh` — self-signed для тестов). HSTS в `infra/nginx/nginx.conf` закомментирован.

---

## 5. Подробные находки по доменам (severity)

### 5.1 Инфраструктура деплоя

| Артефакт | Статус | Примечание |
|---|---|---|
| `infra/docker/Dockerfile.nest`, `Dockerfile.web` | ✅ prod-grade | multi-stage, non-root, healthcheck |
| `infra/docker-compose.prod.yml` | ✅ | canonical deploy target |
| `infra/docker-compose.dev.yml` | ✅ | local dev |
| `.github/workflows/cd.yml` | 🟡 | build+push в GHCR; **нет runtime-deploy** (compose up / kubectl) |
| Kubernetes (`infra/kubernetes/`) | ⛔ README-only | Phase D reference, «НЕ для paper deploy», acceptance criteria непрочеканы |
| Terraform/Pulumi/CloudFormation/Ansible | ⛔ отсутствует | IaC нет |
| `deploy:*` / `release:*` npm-скрипты | ⛔ отсутствуют | `verify:deployment` только post-deploy проверка |
| Автоматизация миграций в deploy | ⛔ | ручной `npm run db:migrate` |
| Secrets backend (Vault/KMS) | ⛔ doc-only | `docs/vault-integration-guide.md`; prod использует plaintext `.env` |
| TLS-сертификаты | 🟡 | nginx-конфиг есть; сертификаты не поставляются |

### 5.2 Observability

| Артефакт | Статус | Примечание |
|---|---|---|
| 7 Grafana dashboards | ✅ | http-overview, execution-latency, slo-overview, paper-trading, risk-policy-writers, dex-overview, dex-paper-mainnet |
| 17 alert rules | ✅ | incl. SRE burn-rate для SLO 99.9% |
| Recording rules | ✅ | paper discovery, paper drift |
| OpenTelemetry tracing | 🟡 | код готов; **OTLP collector в стеке отсутствует** (operator-supplied) |
| Structured JSON logging | ⛔ | plain text; признано в `observability-baseline.md` |
| `/metrics` на 12 сервисах | ✅ | web (Next.js) не скрапируется (допустимо) |
| Alertmanager paging | ⛔ | все receiver'ы → placeholder `localhost:5001`; Slack/PagerDuty закомментированы |
| On-call roster / контакты | ⛔ | TBD во всех runbooks |

### 5.3 Операционная готовность

| Артефакт | Статус | Примечание |
|---|---|---|
| Incident-response playbook | ✅ doc | SEV-1..4, SLA (15м/1ч/4ч/24ч); **контакты TBD** |
| DR-план | ✅ doc | RTO 4h / RPO 24h; ссылки на несуществующий `rollback/` |
| Backup script | 🟡 | `pg_dump` + ротация; **нет restore-сабкоманды**, S3 закомментирован |
| HERMES safe mode | 🟡 | signal-only, не emergency brake |
| Env-var kill-switches | 🟡 | ручное редактирование `.env` + restart |
| CHANGELOG / semver / теги | ⛺ отсутствует | SHA-теги только |
| Миграции rollback | ⛺ | forward-only; `rollback/` dir в доки ссылается на несуществующее |
| Idempotency миграций | 🟡 | 26/38; ранние (001) не idempotent; коллизия `037_` |
| Capacity planning | ✅ doc | 8c/16GB min, 16c/32GB rec; load-test tools есть |
| Load-test results | ⛺ | tools есть (`dex-load-test.mjs`, `venue-load-test.mjs`); опубликованных результатов нет |

### 5.4 Безопасность и капитал

| # | Домен | Severity | Вердикт |
|---|---|---|---|
| 1 | Private key management | **Critical** | AES-256-GCM корректен; software-only, in-memory Map, plaintext Wallet cached на lifetime процесса, нет HSM/KMS/Vault, master key не в env-шаблоне |
| 2 | Key leakage guards | **High** | отличный grep-guard + gitleaks; **но CI non-blocking** |
| 3 | Paper/Live isolation | **Medium-High** | чисто сегодня; контракт rigorous, **но нет CI import-graph enforcement** |
| 4 | DEX live limits & kill-switch | **Critical** | seed есть; бэкенд не читает; `evaluateTrade()` не вызывается; kill-switch фиктивен |
| 5 | Capital exposure controls | **Critical** | per-reservation `FOR UPDATE` ок; **нет aggregate ceiling** (C1); daily-volume in-memory, сбрасывается при рестарте |
| 6 | Operator approval | **High** | UI-компонент хороший; single-operator typed phrase, не two-person; backend per-trade enforcement не найден |
| 7 | Dependency security | **Low** | сильнейшая область; Trivy/Checkov/npm-audit non-blocking, но Dependabot + CodeQL + gitleaks solid |
| 8 | Network/RPC | **Medium** | FallbackProvider + health-checks; нет circuit-breaker, нет outbound rate-limit, backup optional |
| 9 | Bridge safety | **High** | runbooks/rollback отличные; **адаптеры без `.wait()`/confirmation/finality** |
| 10 | Secrets in repo | **Low** | чисто; `.env` untracked, placeholders, нет хардкода |
| 11 | TLS/HTTPS | **High (live)** | nginx TLS ок; **mTLS между сервисами не enforced** (F1), ServiceAuth opt-in |
| 12 | CORS | **Low** | prod-safe (CORS disabled в prod если `CORS_ORIGINS` пустой) |

---

## 6. Рекомендации (порядок приоритета)

### Этап A — закрыть перед paper-deploy
1. **P1** — операторский auth в `apps/web`: реальный session/JWT/IdP или, как минимум, подписанная httpOnly-кука, выданная сервером после проверки.
2. **P2** — подключить реальный paging (Slack/PagerDuty/Telegram receiver'ы в `alertmanager.yml`), убрать placeholder `localhost:5001`.
3. **P3** — починить restore: добавить `restore`-сабкоманду в `tools/backup-postgres.sh` + `db:restore` npm-скрипт; удалить/исправить мёртвые ссылки на `migrations/rollback/`.
4. **P7** — устранить коллизию `037_`; задокументировать prod-процедуру применения миграций (или init-контейнер/entrypoint-хук).
5. **P8/P9** — добавить `/ready` (с проверкой DB/Redis); подготовить TLS-сертификаты для хоста.

### Этап B — live-gate (до любого live-капитала, даже минимального)
6. **L1 + L2** — wire `dex.limits` / `dex.live` / `killSwitch` в execution-orchestrator; реально вызывать `DexRiskPolicyService.evaluateTrade()` на каждом live-leg.
7. **L3** — aggregate capital ceiling с `SELECT SUM(...) FOR UPDATE` в `capital.service.reserve()`.
8. **L5** — confirmation/finality-логика в bridge-адаптерах (chain-specific thresholds, idempotent claim).
9. **L4** — вынести ключи из memory Map (Vault/KMS); убрать кэширование расшифрованного `Wallet` на lifetime процесса; добавить `PRIVATE_KEY_ENCRYPTION_KEY` в `.env.production.example`.
10. **L7** — сделать `secret-scan` блокирующим (`continue-on-error: false`).
11. **L6** — enforce service-to-service auth (mTLS или `ARBIBOT_SERVICE_AUTH_ENABLED=true`).
12. **L8** — backend two-person approval state machine для деструктивных операций.
13. **(C3)** — CI import-graph enforcement paper/live boundary (автоматический grep-gate).

### Этап C — после paper-приёмки (day-2)
14. **P5** — CHANGELOG / semver / release-process.
15. **P4** — structured logging (Pino transport).
16. **P6** — единая «красная кнопка» (panic-button, halt всех сервисов одной командой).
17. Backup S3 upload + автоматизация (cron/systemd/CronJob) + ежемесячная проверка restore.

---

## 7. Сводный счётчик

- **Критических блокеров для LIVE:** 8 (L1–L8)
- **Блокеров для PAPER:** 9 (P1–P9), из которых P1 (auth), P2 (paging), P3 (restore), P7 (миграции) — обязательны до выкатки
- **Готовых subsystem'ов:** контейнеризация, CD, observability-метрики/dashboards/alerts, security-сканнинг репозитория, runbooks — работают

**Принципиальный вывод:** архитектура продумана, документация и threat-modeling необычно детальные, но несколько капитально-критичных контролей реализованы **только как доки/TODO** и не встроены в execution-path. Собственный фрейминг проекта «PAPER-READY, not LIVE-READY» — корректен, и его следует уважать: первый выкат — paper на изолированном хосте, live — только после закрытия L1–L8.

---

## 8. Ссылки на ключевые файлы

- Самооценка проекта: `docs/deployment-readiness-assessment.md`
- Развёртывание: `docs/deployment-guide.md`, `docs/deployment-checklist.md`, `docs/pre-deploy-review.md`
- Угрозы и капитал: `.cursor/skills/dex-security-and-capital-safety/references/threat-model.md`, `references/paper-live-boundary.md`
- Код ключей/капитала: `packages/nest-platform/src/vault/key-vault.service.ts`, `apps/execution-orchestrator/src/execution/wallet-manager.service.ts`, `apps/capital-service/src/capital/capital.service.ts`, `apps/execution-orchestrator/src/execution/risk/dex-risk-policy.service.ts`
- Стек деплоя: `infra/docker-compose.prod.yml`, `infra/docker/Dockerfile.nest`, `.github/workflows/cd.yml`, `.github/workflows/security.yml`
- Observability: `infra/prometheus/alerts.yml`, `infra/grafana/dashboards/`, `infra/alertmanager/alertmanager.yml`
