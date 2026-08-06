# Roadmap — система векторов развития Arbibot-2

> **Назначение:** стратегический каркас для планирования улучшений после архивации
> мастер-плана (`DEVELOPMENT_PLAN.md` помечен «все шаги выполнены»). Векторы — это
> оси оценки с измеримым текущим и целевым состоянием. Конкретные планы улучшений
> собираются из инициатив, привязанных к векторам.
>
> **Связь с другими документами:**
> - Оперативный трекер (что/когда) — [`docs/TODO.md`](TODO.md).
> - Канон статусов/`step_id` — [`.cursor/plans/DEVELOPMENT_PLAN.md`](../.cursor/plans/DEVELOPMENT_PLAN.md).
> - Канон терминов — [`CONTEXT.md`](../CONTEXT.md).
> - Первый план на базе векторов — [`.cursor/plans/DEVELOPMENT_PLAN7.md`](../.cursor/plans/DEVELOPMENT_PLAN7.md) (8/8 done, live-blocker инфраструктура).
> - Второй план на базе векторов — [`.cursor/plans/DEVELOPMENT_PLAN8.md`](../.cursor/plans/DEVELOPMENT_PLAN8.md) (5/5 done, correctness sweep + live-gate enablement).
>
> **Эта документация — живая.** Все факты о состоянии кода в этом файле получены
> из кодовой базы на дату актуализации (см. внизу). Документы (`AGENTS.md`,
> `TODO.md`, ADR) используются только как навигация к коду.

---

## 1. Принципы (как работаем)

Векторы — это «что улучшаем». Принципы — «как». Принципы **важнее** векторов:
любая инициатива нарушает принцип → она отклоняется, какой бы вектор ни закрывала.

### P1. Код — источник истины, не документы

> **Перед началом любой разработки ВАЖНО проверить, что уже есть в коде проекта,
> а не в документах.**

Документация регулярно отстаёт от кода. В этом репозитории уже зафиксированы
случаи, когда `TODO.md` и `AGENTS.md` называли риск «открытым», а в коде он был
давно закрыт:

| Запись в TODO.md (на 2026-07-17) | Реальность в коде (2026-08-01) |
|---|---|
| **C1** «bridge fee estimation — заглушки» | `across-bridge.adapter.ts:398` — suggested-fees API + gas; `stargate-bridge.adapter.ts:508` — on-chain `quoteLayerZeroFee`. Реализовано в коммите `58848ec feat(execution): pre-trade cost estimation`. |
| **C3** «audit-service — 0 unit-тестов» | `apps/audit-service/src/audit/audit.controller.spec.ts` + `audit.service.spec.ts` — есть. |
| **H2** «API key comparison timing-unsafe» | `hermes-auth.guard.ts:1,38-57` — `crypto.timingSafeEqual` с защитой от length-leak. |
| **H3** «config panic.service без unit-тестов» | `panic.service.spec.ts` + `panic.controller.spec.ts` — есть. |
| **H4** «token-approve.service без unit-тестов» | `token-approve.service.spec.ts` — есть. |

**Процедура (обязательна перед стартом шага):**

1. Прочитать цель шага и его формулировку риска в tracker'е.
2. Зайти в указанный файл:строка и проверить **реальное** состояние.
3. Если код уже закрывает риск → пометить запись в `TODO.md` как ✅ resolved со
   ссылкой на файл:строку (или commit), шаг не начинать.
4. Если код подтверждает риск → зафиксировать точные `file:line` в `step_id` плана
   как acceptance-критерий (чтобы рецензент мог проверить по коду, а не по тексту).
5. Если код изменился и риск мутировал → обновить формулировку, не удалять.

Для навигации по коду дешевле использовать graphify-запрос
(`npm run graphify:query -- "..."`) перед запуском тяжёлых Explore-агентов —
см. `AGENTS.md` §graphify.

### P2. После разработки и тестов — обновлять информационные документы

> **Шаг считается завершённым (`status: done`) только когда код слит, тесты
> зелёные, И информационные документы обновлены.**

Какие документы и когда обновлять:

| Тип изменения | Обновить |
|---|---|
| Новый сервис/эндпоинт/env var | `AGENTS.md` (таблица сервисов, BFF, env), `docs/services.md`, `.env.example` |
| Новая миграция БД | `AGENTS.md` §migrations, `docs/TODO.md` (если меняет risk tracker) |
| Закрытие риска из tracker'а | `docs/TODO.md` (статус → ✅ resolved + файл:строка/commit), `docs/security-accepted-risks.md` (если security) |
| Архитектурное решение | Новый/обновлённый `docs/adr-*.md`, ссылка в `AGENTS.md` |
| Новый инструмент/npm-скрипт | `AGENTS.md` §root workspace + `package.json` scripts |
| Изменение вектора/инициативы | Этот файл (`docs/roadmap-vectors.md`) — реестр инициатив |

Чек-лист «document-update» встроен в жизненный цикл шага (см. §4).

### P3. Один основной вектор на шаг

Каждый шаг имеет **один основной вектор** (`vector`) и до **двух вторичных**
(`secondary_vectors`). Это заставляет формулировать главную ценность шага и
предотвращает «лесопильные» эпики, которые пытаются улучшить всё сразу. Если шаг
затрагивает 4+ вектора — его надо разбить.

### P4. Приоритизация по влиянию, усилиям и гейту деплоя

Каждая инициатива оценивается тремя осями:

- **`impact`** (1–5): сколько ценности приносит (для торгового бота приоритет —
  сохранение капитала > прибыль > удобство).
- **`effort`** (1–5, где 5 = XL): стоимость реализации.
- **`gate`**: `live-blocker` (блокирует live-деплой) / `paper-check` (проверить
  на paper-стенде) / `non-critical` (можно после live).

Скоринг: `score = impact × (6 − effort)` (диапазон 5–25), с **Overrides**:
- `gate = live-blocker` поднимается в очередь независимо от score;
- шаги, закрывающие RED-zone из `dex-security-and-capital-safety` SKILL, —
  всегда высший приоритет.

### P5. Реестр инициатив не дублирует операционный трекер

`docs/TODO.md` — операционный (что/когда/владелец/дедлайн).
`docs/roadmap-vectors.md` (этот файл) — стратегический (зачем/в какой очереди/
в каком векторе). Строки связываются через `step_id` + ID риска (C1/H2/M6…).
Дублирования текста риска быть не должно — только ссылка.

---

## 2. Сводная матрица векторов

| # | Вектор | Код | Зрелость | Главная метрика |
|---|--------|----|----------|-----------------|
| 1 | Безопасность и безопасность капитала | `SEC` | 🟢 высокая | # live-blocker'ов в tracker → 0 |
| 2 | Функциональность и торговое преимущество | `FUNC` | 🟡 средняя | edge retention после комиссий |
| 3 | Качество кода и техдолг | `QUAL` | 🟢 высокая | файлов > 500 LOC; lint errors |
| 4 | Тестирование и верификация | `TEST` | 🔴 низкая (фронт) | coverage по пакетам; UI E2E |
| 5 | Производительность и задержки | `PERF` | 🟡 средняя | end-to-end p99; perf-гейт в CI |
| 6 | Надёжность и observability | `REL` | 🟢 высокая | MTTR по drill'ам; RTO/RPO измер. |
| 7 | DevOps и развёртывание | `DEVOPS` | 🔴 низкая | время merge→prod; % авто-деплоев |
| 8 | Operator UX | `UX` | 🟡 средняя | E2E на destructive-флоу |
| 9 | Архитектура и эволюция | `ARCH` | 🟢 высокая | нарушений invariant'ов в CI = 0 |
| 10 | Зависимости и supply chain | `DEP` | 🟡 средняя | открытых runtime CVE; SBOM |

---

## 3. Детализация векторов

Каждый вектор описан по схеме: **что это** → **baseline (уже в коде)** →
**пробелы (с `file:line` где применимо)** → **метрики** → **типичные шаги**.

### 3.1. `SEC` — Безопасность и безопасность капитала

Для торгового бота это первичный вектор: потеря ключей или капитала = прямые
убытки. Дополнительный канон — `dex-security-and-capital-safety` SKILL
(threat-модель K/T/B/C/A).

**Baseline (в коде, проверено 2026-08-01):**
- `KeyVaultService` — AES-256-GCM, per-key random salt (`randomBytes(32)`,
  `key-vault.service.ts:125`), master key через `scryptSync`.
- `HermesAuthGuard` — `crypto.timingSafeEqual` + защита от length-leak
  (`hermes-auth.guard.ts:38-57`). H2 закрыт.
- CI: `secret-scan` (K1/K2 grep, **блокирующий**), `paper-live-boundary`,
  `codeql-sast`, `gitleaks-secrets`, `trivy-docker`, `checkov-iac`,
  `npm-audit`, `dependency-review` (в `.github/workflows/security.yml`).
- Документы: `docs/threat-model.md`, `docs/security-baseline.md`,
  `docs/security-hardening-guide.md`, `docs/vault-integration-guide.md`,
  `docs/key-rotation-runbook.md`, `docs/security-accepted-risks.md`.

**Пробелы (подтверждены кодом):**
- 🟠 **H1** — hardcoded salt для master key derivation
  (`packages/nest-platform/src/vault/key-vault.service.ts:84`,
  `const salt = 'arbibot-vault-salt-v1'`). Per-key salt уже random, поэтому
  риск Medium. Принять для paper; для live — подтвердить уникальность
  `PRIVATE_KEY_ENCRYPTION_KEY` per-deploy (опц. миграция на KMS).
- Принятое: `brace-expansion <= 5.0.7` (GHSA-mh99-v99m-4gvg) — dev/build-time
  only, задокументировано в `security-accepted-risks.md`.

**Метрики:** # live-blocker в `TODO.md` risk tracker → 0; среднее время до патча
критического runtime CVE (< 7 дней); # красных `npm audit` runtime-зависимостей.

### 3.2. `FUNC` — Функциональность и торговое преимущество

Что делает бота более прибыльным/полезным сверх feature-complete ядра.

**Baseline:** все формальные шаги планов 1–6 + DEX выполнены; PAD (paper
AutoDrive) доставлен; bridge fee estimation реализован (C1 закрыт); V3 pricing
для long-tail токенов реализован через канон `@arbibot/contracts-eth`
(`v3Price()` из `slot0.sqrtPriceX96`, #45 — закрывает блокер для V3-only токенов
типа MAGIC).

**Пробелы:**
- 🟡 2 `TODO` в `apps/paper-trading-service/src/paper-discovery/paper-discovery.service.ts:627,632`
  — оценка комиссий/slippage + глубина orderbook в discovery.
- 🟡 AutoDrive safe-by-default (`PAPER_AUTO_DRIVE_ENABLED=false`) — ждёт
  product-decision о включении.
- 🟡 Нет адаптеров под новые DEX/цепи сверх UniV2/V3/Sushi + Across/Stargate/Native.

**Метрики:** покрытие целевых venues/маршрутов; win-rate по
`/paper/trades/stats`; edge retention (spreads после комиссий > 0).

### 3.3. `QUAL` — Качество кода и техдолг

**Baseline (проверено):** 0 `FIXME`/`HACK`/`XXX`, всего 2 `TODO`; lint 29/29 ✅;
build 22/22 ✅; tests 778/778 ✅ (на коммите `afb90d3`).

**Пробелы:**
- 🟡 `console.*` в logic-layer файлах paper-trading (`paper-promotion.service.ts`,
  `paper-trades.service.ts`) → миграция на pino logger.
- 🟡 Крупные файлы: `native-bridge.adapter.ts` ~928 LOC (L6) — кандидат на
  декомпозицию.
- 🟡 Нет `.prettierrc` + `format` скрипта (L4).
- 🟡 Latent bug: `PaperPromotionService.approve` precondition `status==='queued'`
  конфликтует с `assertTransition('queued','promoted')`
  (`apps/paper-trading-service/src/paper/paper-promotion.service.ts:205-246`).
- 🟡 Stray-артефакт `infra/alertmanager/alertmanager.yml;C` (лишний файл).

**Метрики:** # файлов > 500 LOC; цикломатическая сложность hotspots; lint = 0;
# `console.*` вне entrypoints/CLI.

### 3.4. `TEST` — Тестирование и верификация

Крупнейший разрыв в проекте.

**Baseline:** бэкенд business-logic ~95% (audit 100%, paper 96%, orchestrator 90%
по `docs/test-coverage-plan.md`); `apps/web/vitest.config.ts` существует и
настроен, но включает только `lib/**/*.test.ts` + `middleware.test.ts`.

**Пробелы:**
- 🔴 **Фронтенд-компоненты: 60 `.tsx` / 0 компонентных тестов.** Vitest сконфигурирован,
  но `include` покрывает только `lib/` и `middleware`, не `components/`/`app/`.
- 🔴 **Нет браузерных E2E** — ни playwright, ни cypress не настроены.
- 🔴 `packages/persistence`: 43 non-spec / 2 spec — низкое покрытие сущностей.
- 🔴 `packages/contracts-eth`: 20 / 1; `packages/contracts`: 3 / 0;
  `packages/nest-database`: 2 / 0.
- 🟡 Нет contract-тестов между сервисами (OpenAPI/AsyncAPI sync проверяется только
  архитектурным скиллом).

**Метрики:** statement coverage по пакетам (`persistence`, `contracts-eth`) → ≥80%;
наличие E2E на критичные UI-флоу (login, panic-stop, paper approve, destructive
confirm); contract-test gate в CI.

### 3.5. `PERF` — Производительность и задержки

Критично для арбитража: latency = упущенный edge.

**Baseline:** 7 Grafana-дашбордов (вкл. `arbibot-execution-latency`,
`arbibot-slo-overview`); SLO v1 (Tier 1: p99 500ms, 99.9% monthly);
multi-window multi-burn-rate alerts (Google SRE Workbook §5).

**Пробелы:**
- 🟡 Bespoke load-test (`tools/venue-load-test.mjs`, `tools/dex-load-test.mjs`)
  — нет индустриального инструмента (k6 / Artillery) с thresholds.
- 🟡 Нет perf-бенчмарк-гейта в CI (только функциональные e2e).
- 🟡 Нет latency-бюджета по компонентам конвейера
  (intake→opportunity→risk→capital→execution) — только итоговый SLO.

**Метрики:** end-to-end p99; бюджет задержки по хопу; регрессии в CI (k6 threshold).

### 3.6. `REL` — Надёжность и observability

**Baseline:** зрелый — Loki + Promtail + Alertmanager + Grafana + Prometheus;
20 алертов в 9 группах (`infra/prometheus/alerts.yml`); SLO multi-window;
drift workers; reconciliation; 7 drill-процедур с триггерами в `docs/TODO.md`.

**Пробелы:**
- 🔴 **M8 — backup не автоматизирован**: grep по `infra/` пуст (нет pg_dump cron /
  WAL archiving). Только ручной `npm run db:backup`.
- 🔴 **M9 — `node_exporter` отсутствует** → `DiskSpaceLow` alert без данных. При
  аудите маршрутизации (2026-08-01) выявлено дополнительно: `DiskSpaceLow`
  (`severity: warning`, `alerts.yml:164`) не попадает в route `infrastructure`
  (`match_re` только `ServiceDown|HighMemoryUsage|HighErrorRate`), а Slack
  оператор не использует → диск-алерт фактически никуда видимым не доходит.
- ✅ **Структурный пробел «два домена инцидентов»** (выявлен 2026-08-01 при
  аудите для P7-3, **закрыт P7-7**): Alertmanager → reconciliation `POST /alerts/webhook`
  (`alerts.controller.ts:25`) → таблица `alertmanager_incidents` (outbox НЕ
  порождается); а Hermes gateway `GET /hermes/v1/incidents`
  (`hermes.controller.ts:175`) → таблица `reconciliation_mismatches` (другой
  контроллер). **Hermes не видел Prometheus-алерты вообще** — ни диск, ни
  сервис-даун. Закрыто pull-моделью: gateway read-through `GET /hermes/v1/alerts`
  + MCP tool `list_alertmanager_incidents` + cron `alert_watch` → Telegram.
  См. [`docs/adr-hermes-alert-pipeline.md`](adr-hermes-alert-pipeline.md).
- 🟡 Drill'ы `Reconciliation P0` и `Disaster recovery (DB restore)` помечены
  «перед live» — инструменты не созданы (существует только `tools/drill-1-*.mjs`).

**Метрики:** MTTR по drill'ам; покрытие сервисов health-пробами; RTO/RPO
**измеренные** (не заявленные) из drill-прогонов.

### 3.7. `DEVOPS` — Развёртывание и CD

Самый слабый вектор при feature-complete продукте.

**Baseline:** `infra/docker-compose.dev.yml` + `docker-compose.prod.yml`;
`infra/docker/Dockerfile.nest`/`.web` + entrypoints; `infra/nginx/nginx.conf`
(TLS termination, security headers, rate limiting); `infra/pgbouncer/`;
`tools/verify-deployment.sh`, `tools/validate-env.sh`.

**Пробелы (подтверждены):**
- 🔴 **Нет CD**: `cd.yml` — только build + push в GHCR; deploy ручной
  (`docker compose pull && up -d`). Нет helm/kubectl/ssh/terraform job.
- 🔴 **M6 — миграции не применяются автоматически при deploy** (нет one-shot
  migrator контейнера; grep по `infra/` пуст).
- 🔴 **k8s = README only** (`infra/kubernetes/` — нет манифестов).
- 🟡 **M7 — TLS сертификаты извне** (`infra/nginx/ssl/` пустой);
  `tools/generate-tls-certs.sh` есть для self-signed (paper).

**Метрики:** время от merge до prod; % деплоев через автоматизацию; rollback
time; ноль ручных SQL-миграций на проде.

### 3.8. `UX` — Operator UX

**Baseline:** `/dashboard`, `/portfolio`, `/opportunities`, `/execution`, `/paper`,
`/settings`, `/hermes`, `/incidents`; operator auth (JWT cookie `arbibot_session`,
D4-A-1); `DestructiveOperatorAction` с typed-phrase confirm; RBAC.

**Пробелы:**
- 🔴 Нет автотестов UI (см. `TEST`) — Vitest scope не включает компоненты.
- 🟡 Нет E2E на критичные operator-флоу (panic-stop, paper→live gate,
  destructive approve/reject).
- 🟡 Мобильный/адаптивный layout не валидирован.

**Метрики:** task-completion time на ключевые операции; наличие E2E на
destructive-флоу; accessibility baseline.

### 3.9. `ARCH` — Архитектура и эволюция

**Baseline:** самый сильный вектор — `architecture-guard-agent`,
`backend-review-agent`, `frontend-review-agent`; строгие invariant'ы
(single-writer, reservation-first, outbox/inbox, paper/live isolation);
13 ADR; graphify knowledge graph (1974 узлов, 2031 рёбер, 468 сообществ).

**Пробелы:**
- 🟡 Мастер-план архивирован — нет живого roadmap'а следующего поколения
  (=> этот документ его заменяет).
- 🟡 Нет ADR для: CD-стратегии, multi-region, k8s-перехода.
- 🟡 graphify LLM-rebuild pending (только AST-граф; doc↔code cross-refs устарели).

**Метрики:** # нарушений invariant'ов в CI = 0; покрытие решений ADR;
freshness graphify (последний LLM-rebuild).

### 3.10. `DEP` — Зависимости и supply chain

**Baseline:** `.github/dependabot.yml` (3 ecosystems: npm, github-actions,
docker); 9 `overrides` в корневом `package.json`; `tools/validate-dependabot.mjs`
(`npm run validate:dependabot`); `docs/security-accepted-risks.md`.

**Пробелы:**
- 🟡 Нет `renovate.json` (dependabot не делает группировку/major-bump-политику).
- 🟡 Overrides применяются только при fresh resolve
  (`rm -rf node_modules package-lock.json && npm install`) — нет CI-проверки,
  что override реально生效.
- 🟡 Нет генерации SBOM (`cyclonedx`/`spdx`) на release.

**Метрики:** # открытых high/critical CVE в runtime; среднее время до патча;
SBOM на каждый release.

---

## 4. Механика: как из векторов собрать план улучшений

### 4.1. Реестр инициатив

Каждая инициатива — строка в таблице реестра (раздел 5 ниже) с полями:

| Поле | Описание | Пример |
|------|----------|--------|
| `step_id` | ID по конвенции репо: `{VECTOR}-{n}-{SLUG}` | `DEVOPS-M6-MIGRATOR` |
| `vector` | основной вектор (один) | `DEVOPS` |
| `secondary` | вторичные векторы (≤2) | `SEC`, `REL` |
| `gate` | `live-blocker` / `paper-check` / `non-critical` | `live-blocker` |
| `tracker_ref` | ссылка на `TODO.md` risk ID (если есть) | `M6`, `M8` |
| `impact` | 1–5 | `4` |
| `effort` | 1–5 (5 = XL) | `2` |
| `score` | `impact × (6 − effort)` | `16` |
| `status` | `proposed` / `accepted` / `in-progress` / `done` | `accepted` |
| `plan` | ссылка на файл плана | `DEVELOPMENT_PLAN7.md` |

### 4.2. Жизненный цикл шага (расширение конвенции `DEVELOPMENT_PLAN.md`)

Каждый шаг в плане улучшений проходит стадии с обязательными артефактами:

1. **`proposed`** — сформулирован в реестре; есть `file:line`-ссылка на код,
   подтверждающая проблему (по принципу P1).
2. **`accepted`** — принят в план (отдельный `DEVELOPMENT_PLAN{N}.md`); заполнены
   `impact`/`effort`/`gate`/`score`.
3. **`in-progress`** — разработка; перед стартом исполнитель **повторно** сверил
   состояние кода с формулировкой шага (принцип P1) и обновил `file:line` если
   код сместился.
4. **`review`** — код написан, тесты локально зелёные; запущены ревью-скиллы
   (`/architecture-guard`, `/backend-review` или `/frontend-review`, при
   необходимости `/dex-security`).
5. **`done`** — слит в `main` (direct-to-main по `git-workflow-agent`), CI зелёный,
   **и** обновлены информационные документы (принцип P2). До обновления доков
   шаг остаётся в `review`.

### 4.3. Приоритизация по фазе деплоя

- **До live (блокаторы):** всё с `gate=live-blocker`. Первый план
  (`DEVELOPMENT_PLAN7.md`) — скоуп «live-blocker sweep».
- **Paper-стенд (проверка):** `TEST` фронтенд-E2E, `PERF` k6 gate, `DEVOPS` CD
  staging.
- **Пост-live (эволюция):** `FUNC` новые venue'ы, `ARCH` multi-region ADR.

### 4.4. Связь с существующими tracker'ами

Реестр **не дублирует** `docs/TODO.md` и risk tracker, а агрегирует: строки
C1/H2/M6 и т.д. ссылочны через `tracker_ref`, операционный tracker остаётся
«что/когда», roadmap — «зачем/в какой очереди».

---

## 5. Реестр инициатив

> Порядок — по `gate` (live-blocker первыми), затем по `score` (убывание).
> Скоуп первого плана (`DEVELOPMENT_PLAN7.md`) — initiatives `#1–#6` + `#18`
> (Hermes alert pipeline добавлен в PLAN7 как `P7-7` после аудита маршрутизации
> 2026-08-01) — все `done`.
> Скоуп второго плана (`DEVELOPMENT_PLAN8.md`) — initiatives `#19–#23`
> (сформирован из аудита кода 2026-08-02, выявившего, что несколько «готовых»
> защит live-фазы не работают, а Hermes cron-skills молча сломаны).
> Скоуп третьего плана (`DEVELOPMENT_PLAN9.md`) — initiatives `#24–#34`
> (сформирован из глубокого аудита кода 2026-08-03 execution-пути: broadcast
> внутри DB-tx, `on_chain_transactions` никогда не пишется, nonce-гонки,
> reconciliation-детекторы мёртвые, live slippage-gate всегда проходит).
> Scope: **single-chain Arbitrum live-readiness**; cross-chain → отдельный план).
> Скоуп четвёртого плана (`DEVELOPMENT_PLAN10.md`) — initiatives `#35–#44`
> (сформирован из аудита 2026-08-04 архитектурного gap: risk_checked opportunities
> не доходят до live-execution — нет worker'а, создающего execution plans.
> Гибрид: opp-service setup-only saga + EO LegAutoDriverWorker + HTTP callback
> feedback; правки Гермеса Р1-2/Р2-1…6 учтены). Scope: **live auto-execution
> (single-chain)**; cross-chain → отдельный план.
> Скоуп пятого плана (`docs/plan-hermes-live-correctness-2026-08-06.md`) — initiatives
> `#45–#47` (сформирован из факт-чека анализа Hermes 2026-08-05: V3 pricing блокер,
> staticNetwork-реверс, audit-UUID валидация). Все `done`.

| # | step_id | Вектор(ы) | gate | tracker | impact | effort | score | status | plan |
|---|---------|-----------|------|---------|--------|--------|-------|--------|------|
| 1 | `DEVOPS-M6-MIGRATOR` | DEVOPS (SEC, REL) | live-blocker | M6 | 4 | 2 | 16 | done | PLAN7 |
| 2 | `REL-M8-BACKUP-AUTO` | REL (DEVOPS, SEC) | live-blocker | M8 | 5 | 3 | 15 | done | PLAN7 |
| 3 | `REL-M9-NODE-EXPORTER` | REL | live-blocker | M9 | 3 | 2 | 12 | accepted | PLAN7 |
| 4 | `REL-DRILL-RECON-P0` | REL | live-blocker | drill | 4 | 2 | 16 | done | PLAN7 |
| 5 | `REL-DRILL-DR-RESTORE` | REL (DEVOPS) | live-blocker | drill | 4 | 2 | 16 | done | PLAN7 |
| 6 | `SEC-H1-VAULT-SALT` | SEC | live-blocker | H1 | 3 | 2 | 12 | done | PLAN7 |
| 7 | `DEVOPS-CD-PIPELINE` | DEVOPS | paper-check | M5 | 5 | 4 | 10 | proposed | — |
| 8 | `TEST-WEB-E2E` | TEST (UX) | paper-check | L5 | 5 | 4 | 10 | proposed | — |
| 9 | `TEST-PERSISTENCE-COV` | TEST | paper-check | — | 3 | 3 | 9 | proposed | — |
| 10 | `PERF-K6-GATE` | PERF | paper-check | — | 4 | 3 | 12 | proposed | — |
| 11 | `DEVOPS-K8S-MANIFESTS` | DEVOPS (ARCH) | non-critical | — | 3 | 5 | 3 | proposed | — |
| 12 | `QUAL-PRETTIER` | QUAL | non-critical | L4 | 1 | 1 | 5 | proposed | — |
| 13 | `QUAL-CONSOLE-LOGGER` | QUAL | non-critical | L2 | 2 | 1 | 10 | proposed | — |
| 14 | `ARCH-ADR-CD-STRATEGY` | ARCH | non-critical | — | 3 | 1 | 15 | proposed | — |
| 15 | `DEP-RENOVATE` | DEP | non-critical | — | 2 | 1 | 10 | proposed | — |
| 16 | `DEP-SBOM` | DEP | non-critical | — | 2 | 2 | 8 | proposed | — |
| 17 | `QUAL-PROMO-PRECONDITION` | QUAL (FUNC) | paper-check | TODO urgent | 2 | 1 | 10 | proposed | — |
| 18 | `REL-HERMES-ALERT-PIPELINE` | REL (UX) | live-blocker | new | 5 | 3 | 15 | done | PLAN7 (`P7-7`) |
| 19 | `REL-HERMES-CRON-SKILLS` | REL (UX) | live-blocker | new | 5 | 2 | 20 | done | PLAN8 (`P8-1`) |
| 20 | `SEC-LIVE-GATE-CORRECTNESS` | SEC (FUNC) | live-blocker | new | 5 | 3 | 15 | done | PLAN8 (`P8-2`) |
| 21 | `SEC-WALLET-KEY-IMPORT` | SEC (FUNC) | live-blocker | new | 5 | 3 | 15 | done | PLAN8 (`P8-3`) |
| 22 | `REL-LIVE-SMOKE-SCRIPT` | REL (DEVOPS) | live-blocker | new | 3 | 2 | 12 | done | PLAN8 (`P8-4`) |
| 23 | `REL-PG-DUMP-CLIENT` | REL (DEVOPS) | paper-check | new | 2 | 1 | 10 | done | PLAN8 (`P8-5`) |
| 24 | `SEC-BROADCAST-IDEMPOTENCY` | SEC (REL) | live-blocker | new | 5 | 4 | 10 | accepted | PLAN9 (`P9-1`) |
| 25 | `REL-ONCHAIN-TX-PERSIST` | REL (SEC) | live-blocker | new | 5 | 3 | 15 | accepted | PLAN9 (`P9-2`) |
| 26 | `SEC-NONCE-LOCK` | SEC (FUNC) | live-blocker | new | 5 | 3 | 15 | accepted | PLAN9 (`P9-3`) |
| 27 | `REL-TXWAIT-TIMEOUT` | REL (SEC) | live-blocker | new | 4 | 2 | 16 | accepted | PLAN9 (`P9-4`) |
| 28 | `SEC-LIVE-SLIPPAGE-GATE` | SEC (FUNC) | live-blocker | new | 5 | 3 | 15 | accepted | PLAN9 (`P9-5`) |
| 29 | `SEC-APPROVE-SWAP-WALLET` | SEC | live-blocker | new | 4 | 2 | 16 | accepted | PLAN9 (`P9-6`) |
| 30 | `REL-RECON-CRON-REAPER` | REL | live-blocker | new | 5 | 3 | 15 | accepted | PLAN9 (`P9-7`) |
| 31 | `REL-SETTLEMENT-OUTBOX` | REL (ARCH) | live-blocker | new | 4 | 4 | 8 | accepted | PLAN9 (`P9-8`) |
| 32 | `SEC-CAPITAL-IDEMPOTENCY` | SEC | live-blocker | new | 3 | 2 | 12 | accepted | PLAN9 (`P9-9`) |
| 33 | `SEC-VAULT-SALT-ASSERT` | SEC | live-blocker | new | 3 | 1 | 15 | accepted | PLAN9 (`P9-10`) |
| 34 | `SEC-GAS-POLICY-CLAMP` | SEC (FUNC) | paper-check | new | 3 | 2 | 12 | accepted | PLAN9 (`P9-11`) |
| 35 | `FUNC-LIVE-AUTO-CONFIG` | FUNC (SEC) | live-blocker | new | 4 | 1 | 20 | proposed | PLAN10 (`P10-1`) |
| 36 | `SEC-LIVE-KILL-SWITCH-READ` | SEC (FUNC) | live-blocker | new | 4 | 2 | 16 | proposed | PLAN10 (`P10-2`) |
| 37 | `FUNC-TOKEN-RESOLVER` | FUNC (SEC) | live-blocker | new | 4 | 3 | 12 | proposed | PLAN10 (`P10-3`) |
| 38 | `FUNC-LIVE-PLAN-SETUP` | FUNC (SEC) | live-blocker | new | 4 | 3 | 12 | proposed | PLAN10 (`P10-4`) |
| 39 | `FUNC-LIVE-AUTO-DRIVE` | FUNC (SEC) | live-blocker | new | 5 | 3 | 15 | proposed | PLAN10 (`P10-5`) |
| 40 | `REL-LEG-AUTO-DRIVER` | REL (SEC) | live-blocker | new | 5 | 4 | 10 | proposed | PLAN10 (`P10-EO`) |
| 41 | `REL-LIVE-COMPLETION-CALLBACK` | REL (ARCH) | live-blocker | new | 3 | 2 | 12 | proposed | PLAN10 (`P10-FB`) |
| 42 | `FUNC-NOTIONAL-TO-AMOUNTIN` | FUNC (SEC) | paper-check | new | 3 | 2 | 12 | proposed | PLAN10 (`P10-AMT`) |
| 43 | `TEST-LIVE-AUTO-DRIVE` | TEST (SEC) | live-blocker | new | 4 | 3 | 12 | proposed | PLAN10 (`P10-8`) |
| 44 | `REL-LIVE-AUTO-DRIVE-SMOKE` | REL (DEVOPS) | live-blocker | new | 3 | 2 | 12 | proposed | PLAN10 (`P10-9`) |
| 45 | `FUNC-V3-PRICING` | FUNC (SEC) | live-blocker | new | 5 | 3 | 15 | done | PLAN11 |
| 46 | `SEC-RPC-STATIC-NETWORK` | SEC (REL) | live-blocker | new | 4 | 1 | 20 | done | PLAN11 |
| 47 | `REL-AUDIT-IDEMPOTENCY-UUID` | REL (SEC) | paper-check | new | 3 | 1 | 15 | done | PLAN11 |

### Легенда

- **gate:** `live-blocker` — блокирует live-деплой; `paper-check` — проверить на
  paper; `non-critical` — можно после live.
- **score:** `impact × (6 − effort)`, диапазон 5–25. Override: live-blocker
  поднимается в очередь независимо от score.
- **status:** `proposed` → `accepted` (взято в план) → `in-progress` → `review`
  → `done`.

---

## 6. Anti-patterns (чего избегать)

- ❌ **Планировать по документам без сверки с кодом.** Именно так в `TODO.md`
  остались «открытыми» C1/C3/H2/H3/H4, уже закрытые в коде. Принцип P1.
- ❌ **Считать шаг готовым до обновления доков.** `status: done` требует
  обновления `AGENTS.md`/`TODO.md`/ADR/`.env.example` по принципу P2.
- ❌ **Эпик «улучшить всё».** Шаг на 4+ вектора — это набор шагов. Принцип P3.
- ❌ **Дублировать текст риска** в реестре и в `TODO.md`. Только ссылка
  (`tracker_ref`). Принцип P5.
- ❌ **Игнорировать `git-workflow-agent`.** Коммиты — direct-to-main, structured,
  linked to `step_id`. См. `AGENTS.md` §git-workflow-agent.

---

*Актуализировано: 2026-08-06 (PLAN11 done — initiatives #45–#47: V3 pricing,
staticNetwork pin, audit UUID; post-Hermes correctness sweep). Все факты о
состоянии кода проверены чтением файлов на эту дату. При изменении кода —
обновить этот файл по принципу P2.*
