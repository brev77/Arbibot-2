# Аудит ТЗ «AutoDriveWorker» против кода Arbibot-2

> **Дата аудита:** 26 июля 2026 г.
> **Объект:** ТЗ «Автоматический сквозной pipeline арбитража» (модуль AutoDriveWorker)
> **Метод:** проверка утверждений ТЗ против исходного кода (не документации)
> **Инструменты:** graphify query, grep, чтение `.ts`-файлов и `.cursor/skills/`
>
> ✅ **Реализовано (2026-07-26):** на основе этого аудита построен и реализован план PAD (10 этапов, PAD-0…PAD-9). Worker размещён в `paper-trading-service` (single-writer), auto-promotion оставлена оператору (paper→live gate), auto-approve opt-in, kill-switch в config-service. См. [`docs/paper-auto-drive-config-keys.md`](paper-auto-drive-config-keys.md), запись в [`docs/TODO.md`](TODO.md) «Сделано». Конфигурация: `paper.auto_drive` (default `enabled: false`). CI: job `e2e-paper-auto-drive`.

---

## 🔴 Главный вердикт

**ТЗ построено на несуществующем фундаменте.** Класса `AutoDriveWorker`, идентификаторов `auto-drive`/`autoDrive`/`auto_drive`, env-переменных `AUTO_DRIVE_*` нет нигде в репозитории — ни в `.ts`, ни в конфигах, ни в миграциях. Граф знаний (graphify) его тоже не знает.

Комментарии в самом коде прямо называют этот компонент **«future auto-enricher»** — то есть задуманным, но не реализованным:

- `apps/opportunity-service/src/opportunities/opportunities.service.ts:137-139`
- `packages/contracts/src/events.ts:214`

Заявление ТЗ «Что есть: AutoDriveWorker уже вызывает `requestRiskEvaluation` и `paperEnqueue`» — **неверно**. Оба метода существуют только как HTTP-обработчики (`opportunities.controller.ts:81, 90`), их никто не вызывает автоматически.

**Следствие:** это не «расширение существующего компонента», а greenfield-разработка с нуля. Оценка «~7 часов» нереалистична.

---

## 🔍 Проверка утверждений ТЗ по коду

### Утверждения о текущем состоянии

| № | Утверждение ТЗ | Вердикт | Доказательство |
|---|---|---|---|
| 1 | AutoDriveWorker существует, каждые 3 сек | ❌ **NOT FOUND** | Нет такого класса, нет `setInterval` на 3 сек в opportunity-service |
| 2 | Env `AUTO_DRIVE_INTERVAL_MS`, `AUTO_DRIVE_BATCH_SIZE` | ❌ **NOT FOUND** | 0 совпадений по всем типам файлов |
| 3 | Драйвер берёт 10 шт. за тик | ❌ **NOT FOUND** | Никакого batch-цикла по detected-возможностям нет |
| 4 | Драйвер фильтрует net > 0 | ❌ **NOT FOUND** | `netProfitUsd` только *записывается* в payload, никогда не *читается* как фильтр |
| 5 | Сканер создаёт ~10/5сек, драйвер ест ~10/3сек | ❌ **FICTION** | Публикация инлайн, по одной, без батчей (`scanner-pipeline.service.ts:157-170`) |
| 6 | Lifecycle `draft → active → settled \| canceled` | ✅ **CONFIRMED** | `paper-trades.service.ts:17-32`, даже богаче (+`canceled` ветки) |
| 7 | `approve()` резервирует капитал + переводит в active | ✅ **CONFIRMED** | `paper-trades.service.ts:124-158`, reserve **до** transition |
| 8 | Метода `settle()` нет | ✅ **CONFIRMED** | Только `list/getById/create/patch/approve/reject/cancel` |
| 9 | `PaperPromotionService.approve()` создаёт draft paper_trades | ❌ **FALSE** | Только патчит кандидата в `promoted` (`paper-promotion.service.ts:200-246`), **не создаёт paper_trades** |
| 10 | `paper-promotion-quality.worker.ts` авто-промоутит | ❌ **FALSE** | Только обновляет `quality_score`/`quality_tier` снапшоты (`runOnce` → `refreshPersistedQualitySnapshots`) |
| 11 | Колонки `exit_price/entry_price/profit_usd/settled_at` | ❌ **NOT FOUND** | Все 4 нужно добавлять. На `paper_trades` всего 12 колонок, ни одного `ALTER TABLE paper_trades` в миграциях 001–045 |
| 12 | Таблица `arbitrage_opportunities` имеет `net_profit_usd` и т.д. | ❌ **FALSE** | Всё в JSONB `payload`. Экономические колонки есть только на **`scanner_findings`** (миграция 044) |

### Критические «дыры», которые ТЗ не заметил

Эти пробелы меняют весь план реализации:

1. **Нет связки `promotion → paper_trade`.** ТЗ предполагает, что после `approve()` кандидата автоматически создаётся `paper_trades (draft)`. В коде такого нет — ни в `PaperPromotionService.approve()`, ни в discovery (`paper-discovery.service.ts:451` — там это TODO). Draft-строки создаёт **только** `PaperTradesService.create()`. **Без этого шага весь pipeline не заработает — некому создавать draft.**

2. **`buyPrice`/`sellPrice` лежат не там, где ТЗ ожидает.** Они не top-level, а вложены в `payload.evidence.{buyPrice, sellPrice}` (`scanner-publisher.service.ts:186-192`). settle-расчёт по `payload.buyPrice` даст `undefined`.

3. **У opportunity нет «paper» состояния.** Всего 3 state: `detected | enriched | risk_checked` (`opportunity-states.ts`). Утверждение «0 дошли до paper trade» нельзя вывести из `state` — только join'ом к outbox/`paper_*` таблицам.

4. **Нет автоматического advance `detected → enriched`.** Только `→ risk_checked` делается автоматически (через `RiskDecisionIssued` в relay). На `detected → enriched` водитель нужен с нуля.

---

## 🏛️ Архитектурные нарушения

ТЗ нарушает **4 из 6** инвариантов Arbibot-2 (проверено против `.cursor/skills/architecture-guard-agent/SKILL.md`, `dex-security-and-capital-safety/references/paper-live-boundary.md`):

| Инвариант | Вердикт | Почему |
|---|---|---|
| **Single-writer** | 🔴 **VIOLATION** | ТЗ ставит AutoDriveWorker в opportunity-service, но он пишет в `PaperTrade`/`PaperPromotionCandidate`, чей единственный writer — `paper-trading-service` (`paper-live-boundary.md:26-27`). Сегодня opportunity-service имеет к paper **только enqueue-доступ** (`paper-client.service.ts:32` — один метод `enqueuePromotionCandidate`). |
| **Operator approval** | 🔴 **VIOLATION** | Auto-approve и auto-promote запрещены даже для paper (`paper-live-boundary.md:83`: «Автоматическое продвижение без operator approval» — в списке запрещённых обходов). `promoted` — это **paper→live gate**, самая опасная авто-точка в системе. Все методы `approve/reject/cancel` сегодня требуют `operatorId`. |
| **Outbox/inbox** | 🔴 **VIOLATION** | ТЗ предлагает opportunity-service **напрямую HTTP-PATCH** статус кандидата. Граница paper сегодня строго outbox-first (AGENTS.md:480). Прямой PATCH — это «скрытая синхронная зависимость», которую скилл прямо запрещает (SKILL.md:34). |
| **Paper/live isolation** | 🔴 **VIOLATION (размещением)** | opportunity-service — на live-пути (владеет ArbitrageOpportunity, хендовер в execution). Встраивание туда логики мутации paper-trade затушёвывает bounded context. PL.1 контракт сейчас чистый — ТЗ его сломает. |
| **Reservation-first** | ✅ **COMPLIANT** | Текущий код резервирует капитал до transition (`paper-trades.service.ts:134` → `:136`). ТЗ должно сохранить порядок. ⚠️ Но reserve и transition — в разных транзакциях; авто-драйвер усилит окно «осиротевшей резервы». Нужна одна транзакция. |
| **Kill-switch** | 🟡 **AMBIGUOUS** | Игнорировать `DEX_LIVE_KILL_SWITCH` для paper — корректно (он live-only, `dex-kill-switch.service.ts:22-24`). Но новый независимый `paper.auto_drive.enabled` без связи с panic-flow ломает операторскую модель «нажал panic — бот встал». Нужно либо привязать к panic-поверхности, либо явно документировать. |

**Вердикт architecture-guard skill: REQUEST_CHANGES с 4 блокирующими нарушениями**, если реализовывать как написано.

---

## 🛠️ Что исправить в ТЗ

### Архитектурно (blocking)

1. **Перенести весь авто-pipeline в `paper-trading-service`.** Это единственный writer `PaperTrade`/`PaperPromotionCandidate`/`PaperCapitalReservation`. precedent уже есть — `PaperPromotionQualityWorker`. opportunity-service остаётся строго enqueue-only.

2. **Отказаться от cross-service HTTP-мутаций** paper-сущностей из opportunity-service. Авто-promotion — внутренний worker paper-trading-service, читающий свои же кандидаты.

3. **Закрыть дыру «кто создаёт draft paper_trade».** ТЗ её вообще не видит. Нужен шаг: кандидат `promoted` → создать `paper_trades (draft)` (сейчас не делается никем).

4. **Не авто-промоутить и не авто-апрувить без оператора.** Это нарушает paper→live gate. Если автоматизация нужна — ограничить только `settle` (active→settled, запись P/L в `summary` jsonb, что *менее* опасно) и требовать явный opt-in оператора per-route/per-candidate.

### Фактические исправления

5. **Payload:** читать `payload.evidence.buyPrice/sellPrice`, а не top-level. Или — лучше — джойнить к `scanner_findings.net_profit_usd`/`buy_venue` (там эти колонки реальные, миграция 044), а не пытаться парсить JSONB у opportunity.

6. **Миграция:** новые колонки `exit_price/entry_price/profit_usd/settled_at` — это миграция **`046`** (следующий свободный), плюс правка `packages/persistence/src/paper-trade.entity.ts`. Путь `apps/paper-trading-service/src/paper/entities/` в ТЗ **несуществующий** — сущности живут в shared `@arbibot/persistence`.

7. **Kill-switch:** хранить `paper.auto_drive.*` в config-service (single-writer), не в env. И явно решить, должен ли `panic:stop` глушить paper тоже.

### Чего не хватает в ТЗ

- **Резерв + transition в одной транзакции** (сейчас gap, авто-драйвер усилит).
- **Идемпотентность settle** — `settle()` должен быть идемпототентным (как `approve`/`cancel` с `idempotency_key`), иначе двойной тик задвоит P/L.
- **Dedup à-la scanner** — без cooldown авто-драйвер будет циклически переоценивать одни и те же opportunities (в сканере есть `SCANNER_DEDUP_COOLDOWN_MS` на 60с — нужен аналог).
- **Метрики** `arb_auto_drive_*` — название ок, но нужны и labels `reason` (skipped_no_payload, skipped_zero_profit, settle_double_call) — без них debug будет слепым.
- **Защита от зацикливания** при `relay` ещё не дошёл: ТЗ говорит «skip, retry next tick» — но без max-attempts это будет вечный retry. В scanner-orphan-worker есть `resolveMaxAttempts()` — взять паттерн.

---

## 📋 Скорректированный объём работ

ТЗ оценивает в «~7 часов» на основании ложной предпосылки «компонент уже есть». Реально:

| Шаг | Реальный объём |
|---|---|
| Создать `AutoDriveWorker` в paper-trading-service (не расширить несуществующий) | middle |
| Связка candidate `promoted` → `paper_trades (draft)` (этап, которого ТЗ не видит) | middle |
| Migration 046 + entity (`exit_price` и др.) | small |
| `PaperTradesService.settle()` с идемпотентностью | middle |
| Auto-settle worker (только settle — не promote/approve) | small |
| API `/paper/trades/history`, `/stats` + BFF | middle |
| Транзакция reserve+transition | small |
| Метрики + e2e | middle |

Реалистично **2–3 дня**, а не 7 часов, и с обязательным прогоном через `/architecture-guard` и `/dex-security` перед коммитом.

---

## 📌 Сводные доказательства по файлам

### opportunity-service (live path)

- `apps/opportunity-service/src/app.module.ts` — нет AutoDriveWorker в провайдерах
- `apps/opportunity-service/src/opportunities/opportunities.module.ts` — нет AutoDriveWorker
- `apps/opportunity-service/src/opportunities/opportunities.controller.ts:81, 90` — `paperEnqueue`/`requestRiskEvaluation` только HTTP-эндпоинты
- `apps/opportunity-service/src/opportunities/opportunities.service.ts:137-139, 380-471` — комментарий про «future auto-enricher»; `paperEnqueue` пишет outbox, не вызывает paper-мутации
- `apps/opportunity-service/src/opportunities/opportunity-states.ts:2-6` — только 3 состояния: `detected | enriched | risk_checked`
- `apps/opportunity-service/src/opportunities/paper-client.service.ts:32` — единственный метод `enqueuePromotionCandidate` (enqueue-only)
- `apps/opportunity-service/src/outbox-relay.service.ts:122` — async-контракт границы paper
- `apps/opportunity-service/src/paper-discovery/paper-discovery-worker.ts:23, 28` — единственный worker в сервисе, интервал `PAPER_DISCOVERY_POLL_MS` (default 300 000 мс = 5 мин), только создаёт detected-строки

### paper-trading-service (paper path, единственный writer paper-сущностей)

- `apps/paper-trading-service/src/paper/paper-trades.service.ts:17-32` — state machine `TRADE_STATE_ALLOWED`
- `apps/paper-trading-service/src/paper/paper-trades.service.ts:124-158` — `approve()` резервирует капитал **до** transition
- `apps/paper-trading-service/src/paper/paper-trades.service.ts` — нет метода `settle()`
- `apps/paper-trading-service/src/paper/paper-promotion.service.ts:200-246` — `approve()` только патчит статус кандидата, **не создаёт paper_trade**
- `apps/paper-trading-service/src/paper/paper-promotion-quality.worker.ts:51-56` — только `refreshPersistedQualitySnapshots()`, не продвигает
- `apps/paper-trading-service/src/paper-discovery/paper-discovery.service.ts:451` — TODO «would be injected in real implementation»

### scanner-service (источник opportunity)

- `apps/scanner-service/src/scanner/scanner-publisher.service.ts:94, 167-194` — `signedFetch` POST `/opportunities`, payload `OpportunityDetectedPayloadV1`
- `apps/scanner-service/src/scanner/scanner-publisher.service.ts:186-192` — `buyPrice/sellPrice` вложены в `payload.evidence`
- `apps/scanner-service/src/scanner/scanner-pipeline.service.ts:157-170` — публикация инлайн, по одной, без батчей
- `apps/scanner-service/src/scanner/scanner-dedup.service.ts:30-43` — `SCANNER_DEDUP_COOLDOWN_MS` (60с) — единственный throttle
- `apps/scanner-service/src/scanner/scanner-orphan-worker.service.ts:96-103, 181` — retry-паттерн с `resolveMaxAttempts()`

### Схема БД

- `infra/postgres/migrations/001_core.sql:19-27` — `arbitrage_opportunities`, всё в JSONB `payload`, нет экономических колонок
- `infra/postgres/migrations/003_opportunity_risk_decision.sql` — единственный `ALTER TABLE arbitrage_opportunities`
- `infra/postgres/migrations/016_paper_trading.sql:3-16` — `paper_trades`, 12 колонок, без `exit_price/entry_price/profit_usd/settled_at`
- `infra/postgres/migrations/044_scanner.sql:36-55` — `scanner_findings` с реальными `spread_bps/gross_profit_usd/net_profit_usd/buy_venue/sell_venue`
- `infra/postgres/migrations/021_paper_capital_reservations.sql` — `paper_capital_reservations` (виртуальный капитал)
- `packages/persistence/src/paper-trade.entity.ts:13-46` — entity, который нужно править (не `apps/.../entities/`)
- `packages/persistence/src/arbitrage-opportunity.entity.ts` — entity opportunity

### Архитектурные скиллы

- `.cursor/skills/architecture-guard-agent/SKILL.md:30, 34, 38, 71, 74, 90, 112` — single-writer, outbox/inbox, operator approval
- `.cursor/skills/dex-security-and-capital-safety/references/paper-live-boundary.md:17-27, 73-86, 90-100, 128-132` — paper/live изоляция, operator approval gate
- `.cursor/skills/dex-security-and-capital-safety/SKILL.md:79, 87-93, 122-126` — C3 contamination, operator-control, reservation-first
- `apps/execution-orchestrator/src/execution/risk/dex-kill-switch.service.ts:11-29` — kill-switch live-only

---

## TL;DR для автора ТЗ

1. **`AutoDriveWorker` не существует** — это greenfield, не расширение. Убрать формулировки «Что есть».
2. **4 архитектурных нарушения** — главное blocking: размещение в opportunity-service ломает single-writer + paper/live изоляцию. Перенести в paper-trading-service.
3. **3 фактические ошибки в payload/схеме** — `buyPrice/sellPrice` вложены в `evidence`; экономических колонок на `arbitrage_opportunities` нет (они на `scanner_findings`); путь к entities неверный.
4. **Главная скрытая дыра** — никто не создаёт draft `paper_trades` после promote. Без неё pipeline не заработает.
5. **Auto-promote/auto-approve нарушают paper→live gate** — оставить только auto-settle, остальное через оператора.
