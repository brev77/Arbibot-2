# DEVELOPMENT_PLAN7 — Live-blocker sweep

> **Назначение:** первый план улучшений на базе системы векторов
> ([`docs/roadmap-vectors.md`](../../docs/roadmap-vectors.md)). Скоуп — закрытие
> рисков с `gate = live-blocker`, подтверждённых **чтением кода** (не документов).
>
> **Принципы (из roadmap-vectors.md §1):**
> - **P1 — Код-first:** перед стартом каждого шага исполнитель сверяет состояние
>   кода с формулировкой риска; устаревшие записи в `TODO.md`/`AGENTS.md`
>   помечаются ✅ resolved.
> - **P2 — Пост-разработка = обновление доков:** `status: done` требует обновления
>   информационных документов (`AGENTS.md`, `TODO.md`, `.env.example`, ADR).
>
> **Контекст:** мастер-план `DEVELOPMENT_PLAN.md` архивирован (все шаги `done`).
> Этот план — первый из следующего поколения roadmap-документов.

---

## Сводка шагов

| step_id | Вектор | gate | tracker | impact/effort | status |
|---------|--------|------|---------|---------------|--------|
| `P7-1-MIGRATOR` | DEVOPS | live-blocker | M6 | 4/2 (S) | `planned` |
| `P7-2-BACKUP-AUTO` | REL | live-blocker | M8 | 5/3 (M) | `planned` |
| `P7-3-NODE-EXPORTER` | REL | live-blocker | M9 | 2/2 (S) | `planned` |
| `P7-4-DRILL-RECON` | REL | live-blocker | drill | 4/2 (S) | `planned` |
| `P7-5-DRILL-DR` | REL | live-blocker | drill | 4/2 (S) | `planned` |
| `P7-6-VAULT-SALT` | SEC | live-blocker | H1 | 3/2 (S) | `planned` |
| `P7-7-HERMES-ALERTS` | REL (UX) | live-blocker | new | 5/3 (M) | `planned` |

**Порядок:** P7-3 (node_exporter + routing) → P7-7 (Hermes alert pipeline, зависит
от того, что диск-алерт доходит до `alertmanager_incidents` от P7-3) → P7-1 →
P7-6 → P7-2 → P7-4 → P7-5. Мигратор (P7-1) впереди backup — мигратор сам становится
частью DR-restore (P7-5).

**Out of scope (отложено в реестр, не live-blocker):** CD-пайплайн (M5), фронтенд
E2E (L5), k8s manifests, perf-гейт, vault→KMS миграция (после P7-6).

---

## Сверка с кодом (выполнена 2026-08-01 перед составлением плана)

Перед формированием плана выполнена проверка risk-tracker'а из `docs/TODO.md`
против реального кода (принцип P1). **Устаревшие записи (риск уже закрыт в коде)
исключены из плана:**

| Risk ID | Формулировка в TODO.md | Состояние в коде | Решение |
|---------|------------------------|------------------|---------|
| **C1** | bridge fee estimation — заглушки | `across-bridge.adapter.ts:398` (suggested-fees API + gas), `stargate-bridge.adapter.ts:508` (`quoteLayerZeroFee` on-chain); commit `58848ec` | ❌ исключён — пометить resolved |
| **C2** | утечка handles в тестах | false positive turbo-артефакт (см. TODO.md) | уже resolved |
| **C3** | audit-service — 0 unit-тестов | `audit.controller.spec.ts` + `audit.service.spec.ts` | ❌ исключён — пометить resolved |
| **H2** | API key comparison timing-unsafe | `hermes-auth.guard.ts:38-57` — `timingSafeEqual` + length-leak защита | ❌ исключён — пометить resolved |
| **H3** | panic.service без unit-тестов | `panic.service.spec.ts` + `panic.controller.spec.ts` | ❌ исключён — пометить resolved |
| **H4** | token-approve.service без unit-тестов | `token-approve.service.spec.ts` | ❌ исключён — пометить resolved |
| **H5** | paper-capital.service без unit-тестов | проверить в P7-pre (см. ниже) | — |

**Оставшиеся live-blocker'ы (взяты в план):** M6, M8, M9, drill Reconciliation P0,
drill Disaster recovery, H1 — все подтверждены отсутствием кода/инструментов.

**Migrations note:** `infra/postgres/migrations/` содержит **001–049** (не 001–047,
как в `AGENTS.md` — `048_execution_cost_breakdown.sql`,
`049_dex_limits_min_net_profit_seed.sql` уже добавлены). Обновить `AGENTS.md`
в рамках P7-pre.

---

## P7-pre — Предстартовая сверка и актуализация документов

- **step_id:** `P7-pre`
- **vector:** `QUAL` (вторичный `ARCH`)
- **gate:** `non-critical` (но обязательно до начала P7-1…P7-6)
- **service:** `docs`
- **goal:** Привести `docs/TODO.md` и `AGENTS.md` в соответствие с кодом, чтобы
  план опирался на чистый tracker. Демонстрирует принцип P1 на практике.
- **acceptance_criteria:**
  - В `docs/TODO.md` строки C1, C3, H2, H3, H4 помечены ✅ resolved со ссылкой
    `file:line`/commit (см. таблицу сверки выше).
  - Проверен H5 (`apps/paper-trading-service/src/.../paper-capital.service.ts`)
    на наличие spec; статус обновлён по факту.
  - В `AGENTS.md` §migrations диапазон обновлён с «001–047» до «001–049» с
    упоминанием `048`/`049`.
- **changed_areas:** `docs/TODO.md`, `AGENTS.md`
- **review_required:** `architecture`
- **status:** `planned`

---

## P7-1 — Migrator one-shot контейнер

- **step_id:** `P7-1-MIGRATOR`
- **vector:** `DEVOPS` (вторичные `SEC`, `REL`)
- **gate:** `live-blocker`
- **tracker_ref:** `M6`
- **service:** `infra`
- **goal:** Миграции БД применяются автоматически при deploy, без ручного
  `npm run db:migrate` на проде. Устраняет риск расхождения схемы и пропущенных
  миграций при rolling update.
- **code-first verify (перед стартом):**
  - `grep -rilE "migrat|one-shot" infra/` → ожидаем пусто (подтверждено 2026-08-01).
  - Прочитать `tools/db-migrate.mjs` — понять формат runner'а (лексикографическая
    сортировка `.sql`).
  - Проверить `infra/docker-compose.prod.yml` — где можно добавить `depends_on`
    с healthcheck.
- **acceptance_criteria:**
  - В `infra/docker/` есть `Dockerfile.migrator` (или переиспользуется
    `Dockerfile.nest`) + `entrypoint.migrator.sh`, который запускает
    `node tools/db-migrate.mjs` и выходит с `0` при успехе.
  - В `infra/docker-compose.prod.yml` сервис `migrator` запускается перед всеми
    Nest-сервисами (`depends_on: migrator` с `condition: service_completed_successfully`).
  - Migrator идемпотентен: повторный запуск не падает на уже применённых
    миграциях (проверка `schema_migrations`).
  - Логи мигратора видны в `docker compose logs migrator`.
  - Документ: раздел в `docs/deployment-guide.md` (или новый
    `docs/migrator-runbook.md`) с процедурой troubleshooting при застрявшей
    миграции.
  - `AGENTS.md` обновлён: упоминание migrator-контейнера в §Infrastructure.
- **changed_areas:** `infra/docker/`, `infra/docker-compose.prod.yml`,
  `docs/deployment-guide.md` (или `docs/migrator-runbook.md`), `AGENTS.md`
- **review_required:** `architecture` (затрагивает startup order всех сервисов)
- **status:** `planned`

---

## P7-2 — Автоматизация backup (pg_dump cron + WAL)

- **step_id:** `P7-2-BACKUP-AUTO`
- **vector:** `REL` (вторичные `DEVOPS`, `SEC`)
- **gate:** `live-blocker`
- **tracker_ref:** `M8`
- **service:** `infra`
- **goal:** Автоматизированный backup Postgres по расписанию с проверяемым
  восстановлением. Устраняет риск потери данных при сбое БД без актуального бэкапа.
- **code-first verify (перед стартом):**
  - `grep -rilE "pg_dump|wal_archive|wal_level|backup" infra/` → ожидаем пусто
    (подтверждено 2026-08-01).
  - Прочитать `tools/backup-postgres.sh` — текущий ручной путь (`npm run db:backup`).
  - Прочитать `docs/disaster-recovery-plan.md` — заявленная RPO/RTO.
- **acceptance_criteria:**
  - В `infra/` добавлен backup-сервис (compose) на базе `pg_dump` с cron
    (минимум daily; опц. PITR через WAL archiving для live).
  - Backup'ы пишутся в volume (или S3-совместимое хранилище через env
    `BACKUP_DESTINATION`), с retention (keep last N).
  - Метрика/health: `infra/prometheus/` или health-эндпоинт отражает
    `last_backup_timestamp` + `last_backup_status`.
  - **Restore проверен** в рамках P7-5 (drill DR): backup → drop → restore →
    verify migrations → smoke.
  - Документ: `docs/disaster-recovery-plan.md` обновлён фактической процедурой
    (не только заявленной RPO/RTO).
  - `AGENTS.md` §Infrastructure обновлён.
- **changed_areas:** `infra/docker-compose.prod.yml`, `infra/docker/` (backup
  service), `docs/disaster-recovery-plan.md`, `AGENTS.md`
- **review_required:** `backend` (затрагивает БД — single-writer invariant)
- **status:** `planned`

---

## P7-3 — node_exporter + правка маршрутизации алертов (без Slack)

- **step_id:** `P7-3-NODE-EXPORTER`
- **vector:** `REL`
- **gate:** `live-blocker`
- **tracker_ref:** `M9` (+ правка маршрутизации, выявленная при аудите)
- **service:** `infra`
- **goal:**
  1. Алерт `DiskSpaceLow` (и host-level `HighMemoryUsage`) получает реальные
     данные через `node_exporter` — устраняет «слепую зону» observability.
  2. Переполнение диска становится видимым оператору по правильному маршруту:
     UI `/incidents` **всегда**, Hermes → Telegram (см. P7-7) для notified-класса.
  3. **Slack убирается** из prod-маршрутизации — оператор его не использует;
     единый канал уведомления о проблемах — Hermes → Telegram.
- **code-first verify (перед стартом):**
  - `grep -rilE "node_exporter|nodeexporter" infra/` → ожидаем пусто
    (подтверждено 2026-08-01).
  - Прочитать `infra/prometheus/alerts.yml:164-171` — правило `DiskSpaceLow`
    (`severity: warning`, expr на `node_filesystem_avail_bytes`).
  - Прочитать `infra/alertmanager/alertmanager.yml:64-68` — route
    `infrastructure` с `match_re: (ServiceDown|HighMemoryUsage|HighErrorRate)`
    **не включает `DiskSpaceLow`** → диск идёт в `warnings` receiver.
  - Прочитать `infra/alertmanager/alertmanager.yml.tpl:106-153` — prod-реceivers
    `critical`/`warnings`/`infrastructure` содержат `slack_configs` и
    `pagerduty_configs` (Slack удалить по решению оператора).
- **acceptance_criteria:**
  - **node_exporter:** добавлен в `infra/docker-compose.dev.yml` и
    `docker-compose.prod.yml` (в prod — с bind-mount хост-ФС для реальных метрик:
    `/`, `/proc`, `/sys`, `/dev`). `infra/prometheus/prometheus.yml` скрейпит
    `node_exporter` job.
  - **DiskSpaceLow видим:** после деплоя `node_filesystem_avail_bytes` присутствует
    в Prometheus; алерт переходит в `firing` при тестовом превышении порога
    (временно поднять порог или заполнить тестовый mount для проверки).
  - **Маршрутизация DiskSpaceLow:** правило либо включено в `match_re` route
    `infrastructure`, либо выделено в отдельный route. Решение (какой receiver):
    согласовано с тем, что оператор не использует Slack — критичные инфра-алерты
    должны идти в канал, читаемый P7-7 (Hermes alert pipeline), а не только в
    Slack. Рекомендация: `DiskSpaceLow` поднять до `severity: critical` при
    `< 5%` (двойной порог) — диск, заполненный на 95%+ на ноде с Postgres,
    критичен (WAL не пишется, БД падает).
  - **Slack удалён** из `infra/alertmanager/alertmanager.yml.tpl` (receivers
    `critical`, `warnings`, `infrastructure`); `slack_configs` блоки удалены,
    остаётся PagerDuty для critical (если оператор использует) **и/или** переход
    на Hermes-канал из P7-7. `ALERTMANAGER_SLACK_CHANNEL`/`SLACK_WEBHOOK_URL`
    env-переменные убраны из `.env.example` и `tools/validate-env.sh`.
  - **UI `/incidents`** по-прежнему мержит alertmanager-инциденты (без изменений
    — это уже работает через `arbibot-incidents` receiver → reconciliation
    `/alerts/webhook`).
  - **Cleanup:** stray-артефакт `infra/alertmanager/alertmanager.yml;C` удалён
    (QUAL-бэклог L-уровня, закрываем попутно).
  - `AGENTS.md` §observability обновлён (node_exporter, Slack удалён, Hermes-канал
    описан со ссылкой на P7-7).
- **changed_areas:** `infra/docker-compose.dev.yml`, `infra/docker-compose.prod.yml`,
  `infra/prometheus/prometheus.yml`, `infra/prometheus/alerts.yml` (DiskSpaceLow
  severity/routing), `infra/alertmanager/alertmanager.yml.tpl` (убрать Slack),
  `infra/alertmanager/alertmanager.yml;C` (удалить), `.env.example`,
  `tools/validate-env.sh`, опц. `infra/grafana/dashboards/`, `AGENTS.md`
- **review_required:** `architecture` (observability stack; согласовать с P7-7)
- **status:** `planned`

---

## P7-4 — Drill: Reconciliation P0

- **step_id:** `P7-4-DRILL-RECON`
- **vector:** `REL`
- **gate:** `live-blocker`
- **tracker_ref:** drill «Перед live с реальным капиталом» (см. `docs/TODO.md` Drills)
- **service:** `tools`, `docs`
- **goal:** Процедура P0 reconciliation отрепетирована: искусственный mismatch
  детектируется < 15m, оператор проходит `docs/reconciliation-p0-procedures.md`.
- **code-first verify (перед стартом):**
  - `ls tools/drill*.mjs` → существует только `tools/drill-1-paper-incident.mjs`
    (подтверждено 2026-08-01). Drill-recon отсутствует.
  - Прочитать `docs/reconciliation-p0-procedures.md` — канон процедуры.
  - Прочитать `tools/drill-1-paper-incident.mjs` — паттерн симулятора
    (preflight → inject → poll → report).
- **acceptance_criteria:**
  - `tools/drill-2-reconciliation.mjs` создан по образцу drill-1: preflight →
    SQL-инъекция mismatch (`UPDATE portfolio ... manual_override ...` или
    эквивалент, не разрушающий данных) → polling reconciliation detector →
    pass/fail отчёт с MTTA.
  - `docs/drill-2-reconciliation.md` runbook: prerequisites, критерии DoD
    (detect < 15m), MTTA/MTTR logging, cleanup, troubleshooting.
  - `npm run drill:2` скрипт в корневом `package.json`.
  - Drill прогнан на paper-стенде (или задокументирован как «ждёт стенд» с
    чек-листом prereqs, как drill-1 в сессии 42).
  - `docs/TODO.md` Drills-таблица: строка «Reconciliation P0» обновлена
    результатом прогона.
- **changed_areas:** `tools/drill-2-reconciliation.mjs`, `docs/drill-2-reconciliation.md`,
  `package.json` (scripts), `docs/TODO.md`
- **review_required:** `backend` (reconciliation single-writer)
- **status:** `planned`

---

## P7-5 — Drill: Disaster recovery (DB restore)

- **step_id:** `P7-5-DRILL-DR`
- **vector:** `REL` (вторичный `DEVOPS`)
- **gate:** `live-blocker`
- **tracker_ref:** drill «Перед live» (см. `docs/TODO.md` Drills)
- **service:** `tools`, `docs`
- **goal:** Процедура DR отрепетирована: `pg_dump` snapshot → drop database →
  restore → verify migrations → smoke test. RTO/RPO **измерены**, а не заявлены.
  Проверяет P7-2 (backup) end-to-end.
- **code-first verify (перед стартом):**
  - `ls tools/drill*.mjs` → drill-DR отсутствует (подтверждено 2026-08-01).
  - Прочитать `docs/disaster-recovery-plan.md` и `tools/backup-postgres.sh`.
  - Удостовериться, что P7-2 доставлен (backup-сервис есть) — иначе drill
    некорректен.
- **acceptance_criteria:**
  - `tools/drill-3-disaster-recovery.mjs` создан: preflight → trigger backup
    (через P7-2 сервис или `npm run db:backup`) → drop test-БД → restore →
    `npm run db:verify-migrations:all` → paper smoke (`npm run e2e:phase3` или
    эквивалент) → измерение RTO/RPO.
  - `docs/drill-3-disaster-recovery.md` runbook с DoD, измеренными RTO/RPO,
    cleanup.
  - `npm run drill:3` скрипт.
  - **Зависимость:** выполняется только после `P7-2` = `done`.
  - `docs/TODO.md` Drills: строка «Disaster recovery» обновлена результатом.
  - `docs/disaster-recovery-plan.md` обновлён измеренными (не заявленными)
    RTO/RPO.
- **changed_areas:** `tools/drill-3-disaster-recovery.mjs`,
  `docs/drill-3-disaster-recovery.md`, `package.json`, `docs/TODO.md`,
  `docs/disaster-recovery-plan.md`
- **review_required:** `architecture` (DR всей системы)
- **status:** `planned`

---

## P7-6 — Vault master-key salt (H1)

- **step_id:** `P7-6-VAULT-SALT`
- **vector:** `SEC`
- **gate:** `live-blocker`
- **tracker_ref:** `H1`
- **service:** `packages/nest-platform`
- **goal:** Устранить hardcoded salt в master key derivation. Для live —
  подтвердить уникальность `PRIVATE_KEY_ENCRYPTION_KEY` per-deploy и (опц.)
  вынести salt в env / мигрировать на KMS. Risk Medium (per-key salt уже random),
  но live-blocker по tracker'у.
- **code-first verify (перед стартом):**
  - Прочитать `packages/nest-platform/src/vault/key-vault.service.ts:78-85`:
    `const salt = 'arbibot-vault-salt-v1'` (подтверждено 2026-08-01).
  - Убедиться, что per-key salt остаётся random: line 125 `randomBytes(32)`
    (подтверждено).
  - Проверить `packages/nest-platform/src/vault/key-vault.service.spec.ts` —
    существующие тесты (не сломать).
- **acceptance_criteria:**
  - Salt вынесен в env `VAULT_MASTER_KEY_SALT` (с дефолтом для обратной
    совместимости paper, но `tools/validate-env.sh` требует его явной установки
    в prod — fail-closed).
  - **Обратная совместимость:** существующие зашифрованные ключи в `wallet_keys`
    остаются расшифровываемыми (salt по умолчанию сохранён как fallback, ИЛИ
    миграция перезашифровывает — решение в ADR). Ключи НЕ теряются.
  - ADR `docs/adr-vault-salt.md`: решение (env vs KMS vs оставить с
    документированным обоснованием) + threat-model обоснование.
  - `docs/security-accepted-risks.md` обновлён: H1 закрыт или переведён в
    accepted с обновлённым обоснованием.
  - `tools/validate-env.sh` проверяет `VAULT_MASTER_KEY_SALT` (и/или
    `PRIVATE_KEY_ENCRYPTION_KEY` уникальность) в prod-режиме.
  - `docs/key-rotation-runbook.md` и `docs/vault-integration-guide.md` обновлены.
  - Спеки `key-vault.service.spec.ts` зелёные (добавлен кейс нового salt-пути).
  - `AGENTS.md` §env vars обновлён.
- **changed_areas:** `packages/nest-platform/src/vault/key-vault.service.ts`,
  `packages/nest-platform/src/vault/key-vault.service.spec.ts`,
  `tools/validate-env.sh`, `docs/adr-vault-salt.md`,
  `docs/security-accepted-risks.md`, `docs/key-rotation-runbook.md`,
  `docs/vault-integration-guide.md`, `.env.example`, `AGENTS.md`
- **review_required:** `architecture` (затрагивает capital safety — запустить
  `/dex-security` SKILL дополнительно)
- **status:** `planned`

---

## P7-7 — Hermes alert pipeline → Telegram (push алертов оператору)

- **step_id:** `P7-7-HERMES-ALERTS`
- **vector:** `REL` (вторичный `UX`)
- **gate:** `live-blocker`
- **tracker_ref:** new (выявлено при аудите маршрутизации для P7-3, 2026-08-01)
- **service:** `apps/hermes-gateway`, `packages/hermes-mcp-server`,
  `apps/reconciliation-service`, `tools/hermes-agent`
- **goal:** Оператор получает уведомление о критичных Prometheus-алертах (диск,
  сервис-даун, ошибка-rate) в Telegram через Hermes — вместо Slack, который
  оператор не использует. Сейчас Hermes **не видит** alertmanager-инциденты
  вообще (см. code-first verify) — это структурный пробел, не косметика.
- **code-first verify (перед стартом):**
  - **Два раздельных домена инцидентов** (проверено 2026-08-01):
    - Alertmanager → reconciliation `POST /alerts/webhook`
      (`apps/reconciliation-service/src/alerts/alerts.controller.ts:25`) → таблица
      `alertmanager_incidents` (`alert-incidents.service.ts:40`, single-writer,
      внутри `dataSource.transaction`). **Outbox НЕ порождается** — grep
      `outbox|publish|emit|forward` по `alerts/` пуст.
    - Hermes gateway `GET /hermes/v1/incidents`
      (`apps/hermes-gateway/src/hermes/hermes.controller.ts:175`) → reconciliation
      `GET /mismatches` → таблица `reconciliation_mismatches`
      (другой контроллер). **Это другая таблица** — alertmanager-алерты сюда не
      попадают.
  - **Hermes gateway не имеет `/alerts` или `/webhook` endpoint'а** — grep по
    `apps/hermes-gateway/src/` по `alertmanager|/alerts|alerts/webhook` = 0.
  - **Hermes Agent — pull-модель:** `tools/hermes-agent/hermes-config.yaml:103-130`
    cron-джобы (`reconciliation_report` `0 */6 * * *`, `approval_queue_check`
    `*/5 * * * *`). MCP tools (`packages/hermes-mcp-server/src/tools/incidents.ts`):
    `list_incidents` `:5`, `resolve_incident` `:16`, `list_incident_briefs` `:25`
    — все читают `/mismatches`, **не** `alertmanager_incidents`.
  - **Telegram** (`hermes-config.yaml:45-61`): реактивный бот + cron-notify.
    Push-уведомление на webhook от Alertmanager **не поддерживается** архитектурой.
- **architecture decision (выбрать на старте шага, зафиксировать в ADR):**
  Вариант A (предпочтительный — pull, меньше новых звеньев):
  - reconciliation-service: `GET /alerts/incidents` уже есть
    (`alerts.controller.ts:70`) — читает `alertmanager_incidents`.
  - hermes-gateway: новый read-through `GET /hermes/v1/alerts` → reconciliation
    `/alerts/incidents` (по образцу существующих read-through эндпоинтов, тот же
    `HermesAuthGuard`).
  - hermes-mcp-server: новый MCP tool `list_alertmanager_incidents` → gateway
    `GET /hermes/v1/alerts`.
  - hermes-agent: новая cron-джоба `alert_watch` (интервал ~1–2m, configurable)
    с skill `investigate-alert` → если есть новые `firing` инциденты после
    последнего пуша — summarise через GLM → notify в Telegram.
    State «последний пуш» — в `HERMES_MEMORY_PATH` (как у других cron'ов).
  Вариант B (push): Alertmanager → новый webhook на hermes-gateway
  `POST /hermes/v1/alerts/webhook` → Agent через SSE/queue. Сложнее, новые
  звенья. **Рекомендация — Вариант A** (соответствует существующей pull-архитектуре
  Hermes, не нарушает single-writer — gateway остаётся read-only).
- **acceptance_criteria:**
  - **Вариант A реализован** (или B с ADR-обоснованием):
    - `apps/hermes-gateway`: `GET /hermes/v1/alerts` (read-through →
      reconciliation `/alerts/incidents`), под `HermesAuthGuard`; unit-test на
      контроллер.
    - `packages/hermes-mcp-server`: tool `list_alertmanager_incidents`
      зарегистрирован (`tools/index.ts`), spec на tool.
    - `tools/hermes-agent/hermes-config.yaml`: cron-джоба `alert_watch`
      (configurable интервал `ALERT_WATCH_INTERVAL`, по умолчанию `*/2 * * * *`),
      notify → telegram; skill `investigate-alert` в
      `tools/hermes-agent/skills/`.
    - **Idempotency:** повторная отправка того же `firing` инцидента в Telegram
      не чаще, чем `repeat_interval` (state в memory); `resolved` инцидент
      триггерит одно «resolved»-сообщение.
  - **E2E / smoke:** в `tools/ci-hermes-agent-smoke.sh` добавлена проверка, что
    gateway `/hermes/v1/alerts` отвечает (мок); runtime-проверка (нужны секреты
    GLM/Telegram) описана в `H5-G-RUNTIME`-стиле как manual DoD.
  - **Routing согласован с P7-3:** Alertmanager для notified-класса алертов
    (диск, сервис-даун) идёт в `arbibot-incidents` (→ `alertmanager_incidents`)
    — это уже работает; P7-7 делает следующий ход (→ gateway → MCP → Agent →
    Telegram). Slack из P7-3 убран — Hermes-канал становится единым.
  - **Документы:**
    - ADR `docs/adr-hermes-alert-pipeline.md` (вариант A vs B, обоснование).
    - `docs/hermes-reference.md` / `docs/hermes-gateway-runbook.md` — секция про
      alert pipeline.
    - `apps/hermes-gateway/README.md` — новый эндпоинт.
    - `AGENTS.md` §Hermes Agent — упоминание alert_watch cron + новый MCP tool
      (итого 25 tools).
    - `docs/TODO.md` — новый риск (two incident domains) помечен закрытым этим
      шагом.
- **changed_areas:** `apps/hermes-gateway/src/hermes/` (контроллер + spec),
  `packages/hermes-mcp-server/src/tools/` (alert tool + registration + spec),
  `tools/hermes-agent/hermes-config.yaml` (cron), `tools/hermes-agent/skills/`
  (investigate-alert), `tools/ci-hermes-agent-smoke.sh`,
  `docs/adr-hermes-alert-pipeline.md`, `docs/hermes-reference.md`,
  `docs/hermes-gateway-runbook.md`, `apps/hermes-gateway/README.md`, `AGENTS.md`,
  `docs/TODO.md`
- **review_required:** `backend` (новый gateway эндпоинт + MCP tool contract;
  согласовать с `/architecture-guard` на read-through pattern)
- **status:** `planned`

---

## Жизненный цикл и определения «done»

Расширение конвенции из `DEVELOPMENT_PLAN.md` (lifecycle:
`planned → approved → in_progress → implemented → reviewing → review_passed → done`)
с учётом принципов P1/P2 из `docs/roadmap-vectors.md`:

**Шаг = `done` только когда выполнены ВСЕ условия:**

1. ✅ Код слит в `main` (direct-to-main по `git-workflow-agent`, structured commit
   linked to `step_id`).
2. ✅ CI зелёный: `npm run lint && npm run build && npm run test` для затронутых
   пакетов; соответствующие e2e/smoke jobs.
3. ✅ Ревью-скилл выполнен (`review_required`): `/backend-review` или
   `/frontend-review` или `/architecture-guard`; для P7-6 дополнительно
   `/dex-security`.
4. ✅ **Code-first re-verify (P1):** исполнитель повторно сверил `file:line`
   перед мержем — код не сместился, acceptance-критерии проверены по коду.
5. ✅ **Документы обновлены (P2):** все `changed_areas`-документы актуализированы
   (`AGENTS.md`, `TODO.md`, `.env.example`, ADR, runbooks).

До п.5 шаг остаётся в `review_passed`, не `done`.

---

## Definition of Done для всего плана (P7-gate)

План считается завершённым, когда:

- Все 7 шагов (P7-1…P7-7) + P7-pre = `done`.
- `docs/TODO.md` risk tracker: M6, M8, M9, H1 → ✅ resolved; drill Reconciliation
  P0 + DR — пройдены (с датой и MTTA/MTTR/RTO/RPO); структурный пробел «два домена
  инцидентов» (выявлен при аудите P7-3) → закрыт P7-7.
- `docs/roadmap-vectors.md` реестр: initiatives #1–#7 → `done`.
- Главный live-gate (см. `docs/live-deploy-dod.md`) разблокирован по этим семи
  рискам — следующие блокеры (если есть) переходят в PLAN8.

**Что НЕ входит в P7-gate (явно):** CD-пайплайн, фронтенд E2E, k8s, perf-гейт,
новые DEX-адаптеры — это `paper-check` / `non-critical` инициативы из реестра,
отдельные планы.

---

*Создан: 2026-08-01. Все `code-first verify`-блоки основаны на чтении файлов на
эту дату (коммит `afb90d3`). При смещении кода — обновить `file:line` в шаге
перед стартом (принцип P1).*
