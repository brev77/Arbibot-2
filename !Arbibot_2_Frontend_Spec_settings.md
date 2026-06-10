# Arbibot 2 — фронтенд: подробная спецификация

Версия: 0.1 (для v0.8 архитектуры)

Этот документ описывает целевой фронтенд Arbibot 2 как unified operator surface для: - live trading, - paper trading, - token lifecycle, - observability, - incident handling, - HERMES‑assisted workflows.[file:3]

**Первичный запуск (канон):** оператор **сначала** работает в paper-контуре как в основном режиме приёмки — просматривает те же разделы (`/paper`, фильтр Environment: Paper), валидирует дашборды, алерты и сценарии; после накопления статистики и sign-off переходит к live с **минимальным капиталом**, сохраняя сравнение paper vs live. Paper на старте проекта — не «опция», а **обязательный этап** сквозного теста UI+backend связки.

Документ предназначен для фронтенд‑команды (Next.js + React + TypeScript) и продакт‑овнера.

## 1. Цели фронтенда

1. Дать оператору один интерфейс, в котором одновременно видны:
   * капитал и портфель,
   * ход исполнения сделок,
   * инциденты и деградации маршрутов.[file:3][file:2]
2. Обеспечить безопасное выполнение operator‑действий:
   * запуск runbooks,
   * force hedge / force unwind,
   * управление token lifecycle.[file:2][file:3]
3. Ясно разделять live и paper контуры:
   * визуально (цвет, теги, фильтры),
   * логически (фильтры env, отдельные дашборды).[file:3][file:2]
4. Сделать любой ExecutionPlan и инцидент drill‑down‑friendly:
   * человекочитаемый timeline,
   * связанный audit trail и HERMES‑briefs.[file:3][file:2]

## 2. Технический стек фронтенда

* Framework: Next.js (App Router).
* Язык: TypeScript.
* UI: React.
* Компонентная система: shadcn/ui или эквивалент.[file:1]
* Таблицы: TanStack Table.[file:1]
* Графики: ECharts или Recharts.[file:1]
* Server‑state: React Query (TanStack Query).[file:1]
* Client‑state: Zustand.[file:1]
* Auth: RBAC‑aware session model (ASSUMPTION, интеграция с backend RBAC).
* Тема: тёмная как дефолтная; светлая может быть добавлена позже (ASSUMPTION).

## 3. Глобальный layout приложения

### 3.1 Верхняя навигация (top‑nav)

Постоянная полоса наверху, присутствует на всех страницах:

* Логотип / название проекта.
* Основные разделы:
  + Dashboard (/dashboard)
  + Portfolio (/portfolio)
  + Opportunities (/opportunities)
  + Execution (/execution)
  + Tokens (/tokens)
  + Paper (/paper)
  + Incidents (/incidents)
  + Runbooks (/runbooks)
  + HERMES (/HERMES)
  + Settings (/settings)[file:3]
* Правый блок:
  + Dropdown Environment: Live, Paper, All.
  + Dropdown Time range: Last 15m, 1h, 24h, 7d, Custom.
  + Indicator Risk mode: Normal, Elevated, Frozen (ASSUMPTION, основано на Risk and trust engine).[file:2]
  + Indicator HERMES: Connected, Degraded, Down.[file:1][file:3]
  + User меню (ФИО, роль, Logout).

### 3.2 Глобальная панель фильтров (left filters)

На data‑heavy страницах (/portfolio, /opportunities, /execution, /tokens, /paper, /incidents):

* Multi‑select Venues: выбор бирж и сетей (CEX, DEX, Solana, Arbitrum, Base, BNB Chain и т.п.).[file:2]
* Multi‑select Strategies.
* Segmented control Mode: Fast, Conservative, Manual review, Blocked.[file:2]
* Toggle Show only anomalies: показывает только:
  + opportunities c anomaly flags,
  + инциденты с высоким severity.[file:3][file:2]

Фильтры фиксированы слева (sticky), таблицы и графики скроллятся независимо.

## 4. Роутинг и разделы

### 4.1 Список роутов

Роуты (фиксированы спецификацией):[file:3]

* /dashboard
* /portfolio
* /opportunities
* /execution
* /tokens
* /paper
* /incidents
* /runbooks
* /settings
* /HERMES

## 5. Детальная структура разделов

### 5.1 /dashboard — основной операторский экран

Цель: M1 — оператор одновременно видит капитал, execution и incidents.[file:3]

#### Layout

Три колонки (на >= 1440px):

1. Левая колонка (примерно 25% ширины):
   * Card Capital overview:
     + total capital,
     + разбивка: available / reserved / constrained / exhausted по CapitalBucket.[file:2][file:3]
     + мини‑барчарты по площадкам/сетям.
   * Card Portfolio snapshot:
     + топ‑N токенов по экспозиции,
     + текущий unrealized PnL.[file:2]
2. Центральная колонка (примерно 50%):
   * Верхний блок Opportunity board (condensed):
     + компактная таблица:
       - Token / Route
       - gross edge / net edge
       - spread tier
       - anomaly flags
       - route status
       - eligibility state
       - paper/live метка.[file:3]
   * Нижний блок Execution highlights:
     + список последних N ExecutionPlan:
       - статус (planned / executing / hedged / unwound / failed),
       - token, route, notional, mode.[file:2][file:3]
     + клик по плану открывает правую боковую панель с timeline (см. /execution).
3. Правая колонка (примерно 25%):
   * Card Active incidents:
     + список активных инцидентов с severity.[file:3]
   * Card Route health (ASSUMPTION):
     + список деградировавших маршрутов (из route\_profiles).[file:2]
   * Card HERMES briefs:
     + последние 3 incident briefs и suggestions.[file:3]

#### Вкладки

Внутренние вкладки (shadcn Tabs):

* Overview — описанная выше компоновка.
* Live focus — увеличенная зона Execution + Incidents, урезанная аналитика.
* Risk focus — Capital + Limits + Route health.

### 5.2 /portfolio — портфель и лимиты

Frontend отображает read‑модели из Capital and portfolio.[file:2][file:3]

#### Tabs

* Buckets — CapitalBucket.[file:2]
* Positions — PortfolioPosition.[file:2]
* Limits — лимиты по токенам/биржам/сетям/стратегиям.[file:3]
* History — история PnL и закрытых позиций.

#### Buckets

Таблица + графики:

* Колонки:
  + Bucket id (venue + network + strategy),
  + currency,
  + total,
  + available,
  + reserved,
  + constrained,
  + exhausted.[file:2][file:3]
* Графики:
  + stacked bar по bucket‑ам (total vs reserved vs available).

#### Positions

Таблица открытых позиций:

* Колонки:
  + Token
  + Venue / Network
  + Direction (long/short/neutral)
  + Size (в базовой и котируемой валюте)
  + Unrealized PnL
  + Realized PnL contribution
  + Exposure (by token, exchange, network, strategy).[file:2]

Клик по строке открывает боковую панель:

* lifecycle позиции (opening → open → partially\_hedged → stabilized → closing → closed → archived),[file:2]
* связанный execution timeline (сжатая версия из /execution).

#### Limits

Таблица лимитов:

* По токенам, биржам, сетям, стратегиям:
  + current limit,
  + usage,
  + breach flags.[file:2][file:3]

#### History

* Линия PnL (daily/weekly),
* таблица закрытых позиций:
  + token,
  + venue,
  + entry/exit time,
  + PnL,
  + max drawdown per trade.[file:2]

### 5.3 /opportunities — доска возможностей

Отображает ArbitrageOpportunity + RiskDecision.[file:2][file:3]

#### Tabs

* Live — только opportunities, eligible для live (approved/limited).[file:2][file:3]
* Paper — paper‑only возможности.[file:2][file:3]
* All — общий список.
* Rules (ASSUMPTION) — параметры сортировки/метрик и пользовательские пресеты.

#### Основная таблица

Колонки:

* Token
* Route (например, CEX/DEX/chain)
* Gross edge
* Net edge
* Spread tier
* Anomaly flags
* Route status
* Eligibility state (approved / limited / rejected / expired / stale).[file:2][file:3]
* Mode: fast / conservative / manual\_review / blocked.[file:2]
* Env: paper/live (чёткий тег).[file:3]

Фильтры над таблицей:

* Slider по net edge.
* Toggle Only fast‑eligible.
* Toggle Only new tokens (ASSUMPTION, для Discovery).[file:3]

#### Детальная карточка

Клик по строке открывает side drawer:

* Полный объект ArbitrageOpportunity:
  + state machine: detected → enriched → risk\_checked → approved/limited/rejected → expired,[file:2]
  + economic breakdown: fees, gas, slippage budget, route feasibility.
* Последнее RiskDecision:
  + mode,
  + allowed size,
  + reason\_codes,
  + token\_profile\_version,
  + route\_profile\_version.[file:2]
* Data freshness: возраст snapshot / deep view / funding/fees/gas.[file:2]

### 5.4 /execution — исполнение сделок

Работает поверх ExecutionPlan и ExecutionLeg.[file:2][file:3]

#### Tabs

* Plans
* Timeline
* Venues (ASSUMPTION, агрегированное состояние площадок)

#### Plans

Layout: мастер‑деталь.

* Слева: список ExecutionPlan (фильтруемый):
  + ID / short id,
  + token,
  + route,
  + notional,
  + mode,
  + status (planned, reserved, armed, executing, completed, hedged, unwound, failed, canceled).[file:2][file:3]
* Справа: детальный вид выбранного плана:
  + общая информация (policy‑поля):
    - first\_leg\_policy,
    - partial\_fill\_policy,
    - hedge\_policy,
    - unwind\_policy,
    - timeout\_profile,
    - slippage budget.[file:2]
  + таймлайн статусов ExecutionPlan.
  + таблица ExecutionLeg:
    - leg id,
    - side,
    - venue,
    - status (created, sent, acknowledged, partially\_filled, filled, rejected, canceled, timed\_out, failed),[file:2]
    - attempt\_number,
    - external\_order\_id / tx\_hash,
    - timestamps переходов,
    - status\_reason.[file:2]

Блок Operator actions:

* Кнопки действий:
  + Force hedge,
  + Force unwind,
  + Pause new orders (ASSUMPTION).
* Каждое действие:
  + требует impact preview (показываем что будет сделано),
  + подтверждение с вводом короткого комментария.[file:3][file:2]

#### Timeline

Глобальная лента событий исполнения:

* События:
  + PlanArmed, LegSent, LegPartiallyFilled, LegFilled, HedgeTriggered, UnwindTriggered, PositionClosed и т.п.[file:2]
* Фильтры:
  + по plan id,
  + по token,
  + по venue,
  + по типу события.

### 5.5 /tokens — token lifecycle console

UI для TokenProfile и governance токенов.[file:2][file:3]

#### Tabs

Отражают lifecycle:[file:3][file:2]

* Discovery
* Paper-only
* Candidate live
* Live
* Suspended / blocked

#### Таблица токенов

Для каждой вкладки — таблица:

* Token (symbol, chain, контракт).
* token quality score.[file:3]
* trust state: new / probation / trusted\_fast / trusted\_conservative / restricted / blocked.[file:2]
* trade\_count.
* avg PnL, drawdown.[file:2]
* promotion/demotion suggestions (ASSUMPTION, на основе risk engine и paper/live данных).[file:2][file:3]

Действия по строке:

* Discovery → Paper‑only:
  + Start paper.
* Paper‑only → Candidate live:
  + Send to candidate-live queue.
* Candidate live → Live:
  + Promote to live.
* Live → Suspended:
  + Suspend token.
* Любое → Blocked:
  + Block token.

Все действия показывают impact preview: какие стратегии/объёмы/лимиты будут затронуты.[file:3][file:2]

### 5.6 /paper — paper trading dashboard

Работает поверх PaperTrade и виртуальных CapitalBucket.[file:2][file:3]

На **первичном запуске** проекта `/paper` — ключевой экран **операционной приёмки**: здесь и в связанных фильтрах (Environment: Paper) оператор подтверждает, что весь контур от данных до виртуального исполнения ведёт себя ожидаемо и даёт измеримую статистику **до** перевода средств в live (минимальный капитал на следующем шаге).

#### Tabs

* Summary
* By token
* Promotion

#### Summary

* Cards:
  + total paper PnL,
  + number of active paper trades,
  + route stability metrics.[file:3]
* Графики:
  + paper PnL vs время,
  + drift between paper and live (по PnL/quality).[file:3][file:2]

#### By token

Таблица:

* Token,
* paper trade\_count,
* paper PnL,
* volatility,
* drift vs live (если токен уже допускается в live).[file:3][file:2]

#### Promotion

* Таблица daily/weekly promotion suggestions:[file:3]
  + Token,
  + criteria summary (стабильный PnL, стабильная ликвидность, нормальный spread),
  + recommended action: Promote to candidate live или Hold in paper.
* Кнопка: Send to candidate-live queue (переход/действие в /tokens).

### 5.7 /incidents — инциденты и runbooks

Использует Observability and audit + incidents / runbooks поверх архитектуры.[file:2][file:3]

#### Tabs

* Active
* History
* Runbooks
* Reconciliation

#### Active

Таблица:

* Incident id,
* type:
  + route degradation,
  + reconciliation mismatch,
  + stuck reservation,
  + leader failover,
  + global risk breach и т.п.[file:2][file:3]
* severity,
* affected scope (tokens/venues/strategies),
* статус runbook (not started / in progress / resolved).[file:3]

Клик по строке:

* справа детальный вид:
  + короткий summary (1–3 предложения, как требует UX принцип),[file:3]
  + таймлайн событий (QueryTimeline + audit\_log),[file:2]
  + привязанные runbooks (кнопки запуска),
  + связанные HERMES incident briefs (если есть).[file:3]

#### History

* Таблица закрытых инцидентов,
* фильтры по типу и диапазону дат,
* поле resolution summary.

#### Runbooks

* Catalog:
  + список runbooks, их тип, область действия.
* My queue:
  + runbooks, назначенные текущему оператору.
* Каждый runbook:
  + шаги с чекбоксами,
  + кнопка Mark as completed,
  + запись в audit trail.[file:2][file:3]

#### Reconciliation

Отдельная таблица/вид по:

* reconciliation mismatches,
* stuck reservations,
* расхождениям system.state vs venue state.[file:2][file:3]

### 5.8 /HERMES — панель HERMES

Информация по HERMES Gateway и связанным workflow.[file:1][file:3]

#### Tabs

* Status
* Sessions
* Approvals
* Briefs

#### Status

* Card Gateway status:
  + состояние (Connected/Degraded/Down),
  + latency,
  + список каналов.[file:1][file:3]

#### Sessions

* Таблица последних HERMES сессий:
  + id,
  + operator,
  + created\_at,
  + сценарий (incident, reconciliation, token review и т.п.).[file:3]

#### Approvals

* Таблица очереди approvals:
  + action description,
  + source (какой workflow),
  + статус (pending/approved/rejected).[file:3]
* Кнопки:
  + Approve,
  + Reject,
  + возможен комментарий.

#### Briefs

* Список incident briefs:
  + summary,
  + recommended actions,
  + кнопка Open in incident view (deep link на /incidents/:id).[file:3]

### 5.9 /settings — настройки

(ASSUMPTION, P2‑уровень из фронтенд‑спеки)

* Роли и разрешения (view‑only / operator / admin).
* Feature flags:
  + включение/выключение paper layers,
  + HERMES integration.[file:3][file:1]
* Настройки тем (dark/light).

## 6. UX‑принципы и паттерны

Базируемся на фронтенд‑спеке:[file:3]

1. **Не перегружать оператора всем сразу**:
   * на любом экране есть явный фокус (capital, execution, incidents и т.д.).
   * вторичная аналитика — во вкладках/дополнительных панелях.
2. Опасные действия (hedge, unwind, token suspend/block, runbooks, approvals):
   * обязательный impact preview,
   * подтверждение,
   * запись в audit trail.[file:2][file:3]
3. Ясное разделение paper vs live:
   * отдельный фильтр Environment,
   * теги,
   * отличающаяся насыщенность цветов.[file:3]
4. Execution план всегда раскрывается в человечный timeline:
   * state machine ExecutionPlan и ExecutionLeg показана визуально,[file:2]
   * по клику доступны подробности событий.
5. Incident views:
   * короткий summary,
   * возможность drill‑down до конкретных legs / positions / routes.[file:3][file:2]

## 7. Цветовая схема и визуальный язык

Тёмная тема (основная):

* Фон:
  + основной: #020617 / #050816,
  + панели/карты: #0B1120 / #020617.
* Текст:
  + базовый: #E5E7EB,
  + второстепенный: #9CA3AF.
* Статусы:
  + Успех: приглушённый зелёный,
  + Внимание: янтарный,
  + Ошибка/инцидент: насыщенный красный.

Разделение paper/live:

* Live:
  + более насыщенные статусы,
  + зелёные/красные индикаторы PnL.
* Paper:
  + теги и линии в более мягких голубых/серых тонах,
  + отдельный бейдж PAPER.

Графики:

* Фон: как у панелей (#020617–#0B1120).
* Минимум grid‑линий.
* Tooltips с точными значениями PnL, экспозиции, drift.[file:2][file:3][file:1]

## 8. Data contracts фронтенда

Фронт читает только read‑модели, не operational таблицы.[file:3][file:2]

### 8.1 Endpoints (минимальный набор)

* GET /ui/dashboard-summary
* GET /ui/portfolio-summary
* GET /ui/opportunities
* GET /ui/execution-plans
* GET /ui/token-lifecycle
* GET /ui/paper-summary
* GET /ui/incidents
* GET /ui/HERMES-status[file:3]

(ASSUMPTION: все эти эндпоинты принимают общие query‑параметры фильтров: env, time range, venues, strategies, mode.)

### 8.2 Примеры read‑моделей (укрупнённо)

NB: это не финальные JSON‑схемы, а структура для фронта. Точные схемы должны быть выведены из архитектурного документа и backend‑контрактов.[file:2]

#### DashboardSummary

* capital: aggregated по CapitalBucket.
* top\_positions: массив по крупнейшим экспозициям.
* opportunities\_condensed: верхние N opportunities для центрального блока.
* execution\_highlights: последние N ExecutionPlan.
* active\_incidents: короткий список.
* route\_health: деградации маршрутов.
* HERMES\_briefs: последние краткие summaries.[file:2][file:3]

#### PortfolioSummary

* buckets: список bucket‑ов.
* positions: агрегированный список позиций.
* limits: лимиты и использование.
* history: PnL по времени.[file:2][file:3]

… (аналогично описать Opportunities, ExecutionPlans, TokenLifecycle, PaperSummary, Incidents, HERMESStatus на backend‑стороне.)

## 9. Приоритеты реализации (P0–P2)

Синхронизируемся с фронтенд‑спекой:[file:3]

### P0 (M1 – базовый операторский контур)

* /dashboard (Overview)
* /portfolio (Buckets + Positions)
* /execution (Plans + базовый timeline)
* /incidents (Active + History list)
* Базовая авторизация и роли.

### P1

* /tokens — token lifecycle console.
* /paper — paper trading dashboard.
* /runbooks — UI runbooks.
* Расширенный timeline исполнения и reconciliation views.[file:3][file:2]

### P2

* /HERMES — панель HERMES.
* /settings — admin settings и rollout surfaces.
* Усиленная аналитика и дополнительные графики.[file:3][file:1]

## 10. Нефункциональные требования к фронтенду

1. Производительность:
   * ленивые загрузки тяжёлых таблиц,
   * пагинация и server‑side filtering/sorting (через TanStack Table + React Query).[file:1]
2. Наблюдаемость:
   * логирование ключевых пользовательских действий (опасные операции) в audit trail.[file:2]
3. Безопасность:
   * RBAC‑контроль на уровне UI (скрывать недоступные действия),
   * подтверждения для критичных действий.[file:2][file:3]

## 11. Открытые вопросы / TODO

1. Точная JSON‑схема read‑моделей для всех /ui/\* эндпоинтов (нужно совместно с backend).[file:2][file:3]
2. Детальное описание ролей и разрешений (admin / operator / viewer) и их маппинг на UI‑действия.
3. Финальный набор статусов для:
   * incidents,
   * runbooks,
   * approvals (HERMES).[file:2][file:3]
4. Поддержка светлой темы (низкий приоритет).

## 18. Страница Settings и конфигурационный UX

Фронтенд должен иметь отдельный полноценный раздел Settings, а не только техническую страницу с редкими административными действиями.

### 18.1 Основные вкладки Settings

* General Policies
* Arbitrage Types
* Venues and Networks
* Risk and Execution
* Paper Trading
* Token Lifecycle
* HERMES
* Audit History
* Approval Queue

### 18.2 General Policies

Здесь оператор должен видеть и менять: - min\_arbitrage\_spread\_percent - min\_net\_edge\_percent - глобальные spread thresholds - глобальные stale-data policies

Для min\_arbitrage\_spread\_percent UI должен показывать: - текущее effective value - кто его изменил - когда изменение вступит в силу - какие стратегии и классы арбитража затрагиваются

### 18.3 Arbitrage Types

Отдельные переключатели по каждому виду арбитража: - Spot ↔ Spot - Spot ↔ Futures - Futures ↔ Futures - Futures ↔ Spot - DEX ↔ Futures - Funding Arbitrage - CEX ↔ DEX - DEX ↔ DEX - CEX ↔ CEX

Для каждого вида арбитража нужны три независимые колонки: - Discovery - Paper - Live

### 18.4 Venues and Networks

Таблица настроек должна позволять независимо включать: - tracking - paper - live execution

По каждой бирже / сети / bridge / RPC source.

### 18.5 Risk and Execution Settings

Оператор должен уметь настраивать: - exposure limits - slippage limits - partial fill policy defaults - hedge / unwind timeouts - manual review thresholds

### 18.6 Paper Trading Settings

* virtual capital per bucket
* paper promotion thresholds
* token candidate rules
* drift alert settings

### 18.7 HERMES Settings

* readonly mode
* action approvals required
* enabled channels
* incident briefing toggles
* digest schedule toggles

### 18.8 UX требования к настройкам

* Каждое изменение должно показывать preview эффекта.
* Sensitive settings должны требовать подтверждение.
* Должна быть видна effective value chain: global → override.
* Должен быть rollback к предыдущей конфигурации.
* Должна быть отдельная история изменений и approval queue.