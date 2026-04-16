**Arbibot 2**

**Полная архитектура проекта**

Версия 0.8 · финальная документация: все материалы прошлых версий сохранены и дополнены OpenClaw-интеграцией, стеком, фронтенд-спецификацией и реализационным слоем · без кода

Документ описывает Arbibot 2 не как шаг к MVP, а как полную целевую архитектуру системы: от сбора рыночных данных и поиска возможностей до исполнения, риск-контроля, владения состоянием, консистентности портфеля, paper trading и операторского контура.

Все существующие разделы, доменные сущности и архитектурные идеи сохраняются. Поверх них добавлены те элементы, без которых разработка быстро упрется в неявные решения: SLA, state machines, storage model, message schemas, API-контракты, execution playbooks, failover protocol, observability и реализационный backlog.

# 1. Назначение документа

* Зафиксировать полный спектр процессов Arbibot 2, а не этапность разработки.
* Описать модульную структуру, контракты между модулями и правила владения состоянием.
* Показать, как система масштабируется горизонтально без потери скорости, контроля лимитов и целостности портфеля.
* Отдельно описать secure-by-design контур: шифрование, сервисную аутентификацию, изоляцию секретов и минимальные привилегии.
* Определить место paper trading как самостоятельного контура, который может работать отдельно от боевой торговли и использоваться для накопления истории по новым токенам.
* Зафиксировать **первичный запуск**: paper trading — обязательный этап **сквозного операционного теста** всей связки (данные → возможности → риск → капитал → виртуальное исполнение → наблюдаемость) и сбора статистики **до** включения live; переход к live — с **минимальным капиталом** и жёсткими лимитами после приёмки на paper.

# 2. Принципы полнофункциональной архитектуры

* Полнота охвата. Архитектура описывает весь жизненный цикл сделки, а не только стартовый набор сценариев.
* Разделение контуров. Быстрый путь детекта возможностей отделен от тяжелых расчетов, аналитики и симуляции.
* Модульность. Каждый доменный блок разворачивается и масштабируется независимо от остальных.
* Контрактность. Межмодульные границы описываются через API, события и очереди, а не через неявное совместное состояние.
* Владение состоянием. У каждой сущности есть ответственный модуль-источник истины; параллельные экземпляры не спорят за право записи.
* Идемпотентность и детерминизм. Повтор команды не должен создавать вторую сделку, двойной резерв капитала или дублирующий hedge.
* Безопасная деградация. При потере доверия к данным, маршруту, исполнению или лимитам система уменьшает риск, переводит сделки в conservative режим либо полностью прекращает торговлю.

# 3. Поддерживаемые классы арбитража

* Spot ↔ Spot
* Spot ↔ Futures
* Futures ↔ Futures
* Futures ↔ Spot
* DEX ↔ Futures
* Funding Arbitrage
* CEX ↔ DEX
* DEX ↔ DEX
* CEX ↔ CEX

# 4. Стартовый контур площадок и сетей

* Доверенные сети стартового маршрута: Solana, Arbitrum, Base и BNB Chain.
* Первая волна on-chain исполнения: self-custody EOA-кошельки для DEX и простых мостов.
* Следующая ступень: подключение smart wallets, account abstraction и relayer как отдельного execution-layer.

# 5. Полная карта модулей Arbibot 2

| **Модуль** | **Назначение** | **Синхронные интерфейсы** | **Собственное состояние** |
| --- | --- | --- | --- |
| Edge collectors | Сбор лучших цен, глубины, funding, gas, route health и сетевых сигналов. | GetBestQuotes, GetDeepView, HealthCheck | Кэш снимков рынка, latency-профили источников, rate-limit состояние. |
| Canonical market model | Нормализация инструментов, рынков, сетей, токенов, маршрутов и единиц измерения. | ResolveInstrument, ResolveRoute | Единый справочник рынков, токенов, маршрутов и сетевых профилей. |
| Strategy intelligence | Поиск возможностей, ранжирование идей и расчет экономической модели сделки. | EvaluateOpportunity, RankOpportunity | Opportunity registry, стратегия, объяснение расчета edge. |
| Risk and trust engine | Выбор режима, лимиты, adaptive risk, anomaly detection, manual review и блокировки. | EvaluateRisk, ReserveRiskWindow | Глобальные лимиты, TokenProfile, RouteProfile, trust-флаги, решения risk engine. |
| Execution mesh | План ног, отправка ордеров, hedge, unwind, on-chain execution. | ArmPlan, ExecutePlan, ForceUnwind | ExecutionPlan, ExecutionLeg, подтверждения ордеров, idempotency keys исполнения. |
| Capital and portfolio | Учет bucket-капитала, резервов, позиций, портфеля и сверки результата. | ReserveCapital, CommitFill, ReleaseReserve | CapitalBucket, PortfolioPosition, reserved balances, realized/unrealized PnL. |
| Paper trading engine | Виртуальное исполнение, накопление статистики, поиск новых токенов и сравнение с боевым контуром. | RunSimulation, ScoreNewToken | Virtual CapitalBucket, PaperTrade, paper-only истории и калибровочные выборки. |
| Control plane | Конфигурация, feature flags, секреты, профили риска, режимы согласования. | GetConfig, RotateSecrets, ToggleMode | Политики, секреты, права сервисов, rollout-параметры. |
| Observability and audit | Логи, метрики, трейсы, журнал решений и аудит действий. | WriteAudit, EmitMetric, QueryTimeline | Audit trail, таймлайны сделок, алерты, операционные отчеты. |
| Operator experience | Фронтенд, risk-центр, execution board, dashboard капитала и paper trading. | GetPortfolioView, GetExecutionView | Пользовательские представления, фильтры, сохраненные сценарии обзора. |

# 6. Межмодульные контракты и взаимодействия

Внутри Arbibot 2 должны сосуществовать три вида межмодульного обмена. Каждый вид решает собственный тип задач и не должен подменять остальные.

| **Тип взаимодействия** | **Когда используется** | **Примеры** |
| --- | --- | --- |
| Синхронный API | Команда или запрос требуют немедленного ответа и короткого SLA. | EvaluateRisk, ReserveCapital, ResolveRoute, GetTokenProfile. |
| Событийная шина | Нужно разослать факт произошедшего нескольким подписчикам без жесткой связности. | SnapshotUpdated, OpportunityDetected, RiskDecisionIssued, PlanCompleted, PositionClosed. |
| Очереди задач | Нужна гарантированная доставка, повторная обработка, backpressure и worker-модель. | Deep market enrichment, recalibration, heavy analytics, paper batch simulation, reconciliation jobs. |

## 6.1 Стандарт конверта сообщения

* Каждое сообщение обязано содержать message\_id, correlation\_id, causation\_id, entity\_type, entity\_id, version, source\_module и event\_ts.
* Команды и события должны быть идемпотентны: повторная доставка не должна создавать дублирующее действие.
* Изменяемые агрегаты используют optimistic concurrency: version или compare-and-set токен обязателен для записи.
* Критичные записи публикуются через outbox/inbox паттерн, чтобы событие не потерялось между записью состояния и публикацией в шину.
* На границе модулей используются явные схемы сущностей: ArbitrageOpportunity, RiskDecision, ExecutionPlan, CapitalReservation, PortfolioPosition, PaperTrade.

## 6.2 Базовые доменные команды

* EvaluateOpportunity — расчет полной карточки сделки после сигнала уровня 1.
* EvaluateRisk — выпуск решения fast, conservative, limited, manual review или blocked.
* ReserveCapital и ReserveRiskWindow — атомарная подготовка сделки к исполнению.
* ArmPlan и ExecutePlan — перевод сделки в стадию отправки ног.
* ForceHedge и ForceUnwind — аварийные действия при нарушении допусков.
* CommitFill, ReleaseReserve и ClosePosition — фиксация результата и освобождение ресурсов.

# 7. Контур масштабирования и распределения нагрузки

Масштабирование не может быть оставлено исключительно инфраструктуре. Оно должно быть заложено в доменную структуру, способ хранения состояния и в модель взаимодействия модулей.

* Каждый модуль разворачивается как отдельный сервис или контейнер и может запускаться на разных серверах.
* Новые экземпляры модулей поднимаются без изменения бизнес-логики: добавление серверов увеличивает throughput, а не меняет смысл обработки.
* Модуль считается корректно масштабируемым, если он либо stateless, либо использует вынесенное состояние с четкими правилами владения и записи.
* Параллельные экземпляры получают задачи через partitioning и очереди: по бирже, по сети, по стратегии, по инструменту или по портфелю.
* Load balancing применяется на входе в stateless-сервисы и на уровне очередей для worker-пулов.
* Bulkhead pattern обязателен: деградация одного адаптера, одной сети или одного execution worker не должна останавливать остальные ветви.
* Контуры low-latency execution и тяжелой аналитики разделяются физически и логически: симуляция, recalibration и отчетность не мешают боевым сделкам.

| **Проблема роста** | **Архитектурное решение** |
| --- | --- |
| Рост числа бирж и рынков | Адаптеры работают как независимые worker pools с собственными лимитами и расписаниями опроса. |
| Рост watchlist | Пары делятся на hot, warm и cold tiers с разной частотой обновления и разной глубиной проверки. |
| Рост on-chain сценариев | Выделяется отдельный on-chain execution layer с route cache, сетевым health-контуром и изоляцией RPC-источников. |
| Рост серверов | Сохраняются единые лимиты и единое состояние через single-writer сервисы, резервы и версии агрегатов. |
| Рост симуляции | Paper trading выполняется асинхронно и может быть полностью выключен без влияния на боевой контур. |

# 8. Контур безопасной связи между узлами

* Вся внутренняя связь между сервисами шифруется. Для критичных сервисов предпочтителен mutual TLS или иной эквивалент сервисной идентификации.
* Каждый модуль аутентифицируется как отдельная сервисная сущность. Общие технические аккаунты без разграничения прав не допускаются.
* Принцип минимальных привилегий обязателен: модуль получает доступ только к тем данным и операциям, которые действительно нужны для его роли.
* Секреты изолируются по модулям: отдельные API-ключи, отдельные кошельки, отдельные service tokens, отдельные политики ротации.
* Компрометация одного звена не должна давать прямой lateral movement к другим: сеть сегментируется, доверенные зоны ограничиваются, а доступ между ними протоколируется.
* Особо критичные команды исполнения и вывода средств должны требовать отдельного уровня авторизации, строгой аудитной записи и при необходимости ручного подтверждения.
* Control plane должен уметь мгновенно отзывать доступ, выключать модуль, вращать секреты и переводить систему в safe mode.

# 9. Владение состоянием и консистентность данных

Главная задача при росте числа серверов — не допустить гонок за состояние, двойного резерва капитала, расхождения лимитов и разных версий истины по одной сделке.

| **Домен** | **Владелец состояния** | **Правила консистентности** |
| --- | --- | --- |
| Лимиты риска | Risk and trust engine | Только risk engine принимает итоговое решение по лимитам и выпускает risk token или reservation window для сделки. |
| Капитал и резервы | Capital and portfolio | Резерв капитала атомарен; без reservation token execution не стартует. Освобождение и коммит всегда привязаны к конкретному plan\_id. |
| Позиции и портфель | Capital and portfolio | PortfolioPosition обновляется через последовательность подтвержденных fill-событий; внешний вид позиций строится из единого журнала состояний. |
| Планы исполнения | Execution mesh | ExecutionPlan и ExecutionLeg имеют единственного владельца записи; внешние сервисы могут только присылать события и команды. |
| Профили токенов и маршрутов | Risk and trust engine | TokenProfile и RouteProfile обновляются по проверенным закрытым результатам и системным сигналам, а не напрямую из execution worker. |
| Рыночные снимки | Edge collectors | Snapshot и DeepView имеют явную свежесть и срок годности; stale-данные не могут быть использованы для новой сделки. |

## 9.1 Правила, которые убирают гонки

* Single-writer principle. Для каждого агрегата существует один сервис, имеющий право финальной записи.
* Reservation-first. Сделка сначала резервирует капитал и окно риска, и только затем получает право на исполнение.
* Versioned transitions. Любой переход состояния проверяет ожидаемую версию агрегата.
* Idempotent commit. Повторное событие fill или подтверждение ордера обновляет состояние безопасно и не удваивает результат.
* Reconciliation loop. Независимый сверочный процесс сравнивает внутреннюю модель со статусами бирж и on-chain подтверждениями.

## 9.2 Единые лимиты при росте числа серверов

* Глобальные лимиты должны жить в одном координирующем risk-контуре либо в строго согласованном слое резервирования.
* Открытие сделки без подтвержденного risk token запрещено, даже если локальный worker считает возможность прибыльной.
* Портфель и позиции должны собираться из канонического журнала событий, а не из локальных кэшей отдельных серверов.

# 10. Полная карта процессов Arbibot 2

1. Edge collectors получают быстрые MarketSnapshot по наблюдаемым рынкам и поддерживают их свежесть.
2. Strategy intelligence обнаруживает первичный economic edge и создает ArbitrageOpportunity в состоянии detected.
3. Для подтвержденного сигнала запускается deep enrichment: стакан, комиссии, funding, gas, balances, route feasibility, сеть и latency-профиль.
4. Risk and trust engine оценивает возможность: режим fast или conservative, anomaly flags, лимиты, размер и необходимость manual review.
5. Capital and portfolio резервирует капитал по bucket-модели и проверяет, что сделка не разрушает общую экспозицию портфеля.
6. Execution mesh строит ExecutionPlan, разбивает его на ноги и выбирает политику hedge и unwind.
7. В ходе исполнения система отслеживает подтверждения, частичные fill, проскальзывание, network faults и маржинальные риски.
8. Если одна из ног отстает или происходит критичное нарушение бюджета, запускается hedge либо force unwind.
9. После завершения сделки результат коммитится в портфель, капитал освобождается, а журнал состояний фиксирует полный таймлайн.
10. Закрытые сделки обновляют TokenProfile, RouteProfile, статистику adaptive risk и калибровочные модели.
11. Paper trading может параллельно воспроизводить тот же decision path на виртуальном капитале, не вмешиваясь в боевой контур.
12. Observability and audit формируют объяснение решения, метрики качества исполнения, инцидентные сигналы и операционные отчеты.

# 11. Риск, режимы и аномалии

## 11.1 Критерии выбора fast и conservative режима

| **Критерий** | **Fast режим** | **Conservative режим** |
| --- | --- | --- |
| История токена | Есть достаточная история закрытых боевых сделок, статистика стабильна. | Истории мало, она короткая, шумная или смешана с недоверенными сценариями. |
| Ликвидность | Глубина покрывает целевой объем в пределах slippage budget. | Глубина нестабильна, исполнение чувствительно к объему. |
| Средний результат | Winrate и средний PnL устойчиво положительны в рабочем окне. | Средний PnL близок к нулю, отрицателен или быстро деградирует. |
| Маршрут и сеть | RPC, bridge, finality и gas находятся в зеленой зоне. | Есть деградация сети, роста gas, нестабильный bridge или непредсказуемая финальность. |
| Качество данных | Snapshot и deep view свежие, latency-профиль контролируем. | Есть stale данные, задержка источников или неполная карточка сделки. |
| Размер спреда | Спред находится в нормальном диапазоне и подтверждается моделью. | Спред аномально велик и требует уменьшения объема либо ручной проверки. |
| Trust-профиль | Токен и маршрут находятся в trusted-профиле. | Новый токен, сомнительный контракт, низкая ликвидность или маршрут с флагами доверия. |

## 11.2 Adaptive risk по токену

| **Параметр** | **Минимум** | **Рекомендуемо** | **Практический смысл** |
| --- | --- | --- | --- |
| Сделки для включения adaptive risk | 20 | 50–100 | До 20 сделок риск не меняется. После 50–100 сделок статистика становится достаточно рабочей. |
| Шаг изменения риска | 0.05% капитала | 0.05–0.10% | Шаг должен быть дискретным и ограниченным, без резких прыжков. |
| Базовый риск на сделку | 0.10% | 0.25% | Конкретный базовый уровень должен быть параметром политики, а не жестко зашитой константой. |
| Окно для recalibration | 20 последних сделок | 50–100 сделок или 30–90 дней | Нужна поддержка и счетчика сделок, и временного окна. |

## 11.3 Пороги аномального спреда

| **Tier токена** | **Минимум** | **Рекомендуемо** | **Жесткая реакция** |
| --- | --- | --- | --- |
| High-liq | 35 bps | 50 bps | 80–100 bps: conservative или manual review. |
| Mid-liq | 75 bps | 100 bps | 150 bps: limited volume или manual review. |
| Low-liq | 150 bps | 200 bps | 250+ bps: только manual review или блокировка. |

* Практическое правило: итоговый anomaly threshold берется как максимум статического порога по liquidity tier и динамического отклонения от собственной истории токена.
* Даже высокий номинальный спред не считается качественной возможностью, если он не подтвержден глубиной, исполнением и trust-профилем маршрута.

# 12. Исполнение, hedge и принудительный unwind

| **Триггер** | **Что фиксируется** | **Реакция системы** |
| --- | --- | --- |
| Потеря нейтральности хеджа | Отклонение дельты или экспозиции выше бюджета. | Авто-хедж; при неудаче — force unwind. |
| Частичное исполнение ноги | Одна нога исполнена, встречная нога не закрыта вовремя. | Снижение объема, хеджирование остатка, отмена хвоста или unwind. |
| Проскальзывание выше бюджета | Фактическое исполнение хуже ожидаемого. | Остановка дальнейших ордеров и пересчет сделки. |
| Margin pressure | Collateral buffer или маржинальный запас ниже порога. | Срочное снижение позиции и возможный unwind. |
| Деградация данных | Snapshot stale, deep view expired или пропали подтверждения источников. | Запрет новых сделок и защитное завершение активных сценариев. |
| Маршрутная деградация | RPC fault, bridge fault, gas spike, finality delay. | Перевод в conservative или полный отказ от маршрута. |
| Глобальный риск | Превышены лимиты по сделке, токену, бирже или портфелю. | Немедленная блокировка и аварийный сценарий закрытия. |

* ExecutionPlan должен содержать hedge\_policy, unwind\_policy, timeouts, slippage budgets и idempotency keys для каждой ноги.
* ExecutionLeg является атомарной единицей наблюдения: у нее есть собственный статус, таймаут, подтверждение и причина отказа.

# 13. Капитал, портфель и paper trading

* CapitalBucket — основная единица управления капиталом. Bucket сегментируется по площадке, сети, валюте, стратегии и, при необходимости, по профилю риска.
* Резерв капитала должен происходить до старта исполнения и быть видимым для всех серверов, чтобы параллельные инстансы не использовали одни и те же средства дважды.
* PortfolioPosition должна отражать не только текущее состояние ноги, но и агрегированную экспозицию портфеля по токену, бирже, сети и классу стратегии.
* Paper trading работает на виртуальных CapitalBucket и виртуальных позициях, но повторяет боевой decision path: risk checks, mode selection и sizing rules.
* На **стадии первичного запуска** проекта paper trading рассматривается как **каноничный режим приёмки**: полный прогон всех систем и режимов без риска реальных потерь, накопление метрик для решения о включении live; это дополняет, а не заменяет автоматизированные тесты.
* После приёмки оператор переводит контур в live **с минимальным капиталом**; paper может оставаться активным для сравнения paper vs live и расширения universe.
* Paper trading можно включать и выключать независимо от боевого контура. Его остановка не должна влиять на торговлю, а торговля не должна зависеть от paper-процессов.
* Допустим отдельный paper-режим поиска новых токенов: он собирает историю, качество исполнения и маршрутные характеристики по активам, которые еще не допущены к fast или live-режиму.
* При пересчете adaptive risk боевые закрытые сделки имеют больший вес, чем paper-сценарии; paper-данные расширяют выборку, но не подменяют реальную доходность.

# 14. Расширенная схема жизненного цикла сущностей

## 14.1 ArbitrageOpportunity

* detected → enriched → risk\_checked → approved / limited / rejected → expired
* Возможность не может быть исполнена напрямую из состояния detected; обязательны enrichment и risk decision.

## 14.2 RiskDecision

* draft → evaluated → approved / limited / manual\_review / blocked / force\_unwind
* RiskDecision живет как отдельный доменный объект и должен быть полностью объясним по причинам принятия.

## 14.3 ExecutionPlan и ExecutionLeg

* planned → reserved → armed → executing → completed / hedged / unwound / failed
* Статус плана агрегирует статусы ног, но не скрывает частичное исполнение и аварийные шаги.

## 14.4 TokenProfile и RouteProfile

* TokenProfile: new → probation → trusted\_fast / trusted\_conservative → restricted → blocked.
* RouteProfile: candidate → trusted → degraded → suspended.
* Переход в trusted\_fast возможен только при достаточной истории, стабильной ликвидности и контролируемой просадке.

## 14.5 CapitalBucket и PortfolioPosition

* CapitalBucket: active → constrained → exhausted → rebalancing → frozen.
* PortfolioPosition: opening → open → partially\_hedged → stabilized → closing → closed → archived.

## 14.6 PaperTrade

* simulated → tracked → closed → archived.
* PaperTrade должен сохранять decision trace, чтобы потом сравнивать симуляцию и реальный execution path.

# 15. Что должен видеть фронтенд

* Token profile view: trade\_count, текущий risk step, winrate, avg PnL, drawdown, eligibility для fast-режима.
* Opportunity board: gross edge, net edge, spread tier, anomaly flag, trust status, маршрут, причина ограничения.
* Execution timeline: состояние каждой ноги, hedge/unwind события, задержки, источники подтверждения и audit trace.
* Capital dashboard: доступный, зарезервированный, constrained и exhausted капитал по площадкам, сетям и стратегиям.
* Portfolio dashboard: открытые позиции, совокупная экспозиция, лимиты и конфликтующие направления риска.
* Paper trading dashboard: виртуальные сделки, поиск новых токенов, расхождение между paper и live, результаты recalibration.

# 16. Итог архитектурной версии 0.8

* Arbibot 2 описан как полная доменная система, а не как краткий контур стартовой реализации.
* В документ встроены межмодульные контракты, модель масштабирования, secure-by-design взаимодействие и правила владения состоянием.
* Отдельно формализованы единые лимиты, единое состояние сделок и портфеля, а также роль paper trading как автономного, но полезного контура.
* Следующий уровень детализации после этой версии — формальные схемы сообщений, SLA между модулями и выбор конкретных технологических компонентов реализации.

# 17. Что еще нужно для старта разработки

Для реального старта разработки не хватает инженерного слоя, который переводит архитектурные идеи в набор однозначных правил. Следующие разделы не заменяют текущую модель, а фиксируют обязательные детали реализации.

* Без них команда сможет начать писать сервисы, но очень быстро упрется в спорные решения по состоянию, execution semantics, резервированию, отказам и лимитам.
* Все новые разделы ниже нужно трактовать как implementation-ready надстройку над тем, что уже описано в документе.

# 18. SLA, свежесть данных и операционные бюджеты

## 18.1 End-to-end SLA

* Snapshot → Opportunity: целевой p50 до 25 мс, целевой p95 до 80 мс.
* Opportunity → RiskDecision: целевой p50 до 10 мс, целевой p95 до 30 мс.
* RiskDecision → CapitalReservation: целевой p50 до 10 мс, целевой p95 до 40 мс.
* Reserve → ArmPlan: целевой p50 до 10 мс, целевой p95 до 25 мс.
* ArmPlan → отправка первой ноги: целевой p50 до 20 мс, целевой p95 до 80 мс.
* Если контур систематически не укладывается в p95, он не считается пригодным для fast-режима.
* Для paper trading допускаются более мягкие SLA, но decision path должен повторять боевой контур логически, а не концептуально.

## 18.2 Freshness policy

* L1 / быстрый snapshot: fresh до 250 мс, stale старше 5 секунд, реакция — запрет новых сделок по источнику.
* Deep view: fresh до 1 секунды, stale старше 5 секунд, реакция — перевод в conservative.
* Funding / fees / gas: fresh до 5 секунд, stale старше 30 секунд, реакция — повторная проверка.
* Route health: fresh до 5 секунд, stale старше 30 секунд, реакция — деградация маршрута.
* Каждая запись market data должна содержать source\_timestamp, ingest\_timestamp и publish\_timestamp.
* Любая возможность, построенная на stale-данных, должна быть помечена как неисполняемая для live-контура.

# 19. Формальные state machines ключевых сущностей

## 19.1 ArbitrageOpportunity

* detected → enriched → risk\_checked → approved / limited / rejected → expired
* Дополнительные terminal-состояния: canceled, superseded, stale.
* Opportunity не может перейти в approved без полной карточки: fees, slippage budget, route feasibility, data freshness и eligibility.

## 19.2 RiskDecision

* draft → evaluated → approved / limited / manual\_review / blocked / force\_unwind
* Каждое решение обязано иметь reason\_codes, risk\_step, token\_profile\_version и route\_profile\_version.

## 19.3 ExecutionPlan

* planned → reserved → armed → executing → completed / hedged / unwound / failed / canceled
* ExecutionPlan обязан хранить first\_leg\_policy, partial\_fill\_policy, hedge\_policy, unwind\_policy, timeout\_profile и slippage budget.

## 19.4 ExecutionLeg

* created → sent → acknowledged → partially\_filled / filled / rejected / canceled / timed\_out / failed
* У каждой ноги должны быть attempt\_number, idempotency\_key, external\_order\_id или tx\_hash, status\_reason и timestamps переходов.

## 19.5 CapitalReservation

* requested → granted → committed / released / expired / failed
* Reservation не может зависнуть без TTL и sweeper policy.

## 19.6 PortfolioPosition

* opening → open → partially\_hedged → stabilized → closing → closed → archived
* Позиция строится из подтвержденных execution событий, а не из предположений execution worker.

# 20. Storage model и канонические таблицы

Для старта разработки обязательно зафиксировать базовую storage model. Ниже приведен минимальный обязательный набор таблиц и агрегатов.

* market\_snapshots — нормализованные snapshots, freshness и source timestamps.
* arbitrage\_opportunities — карточка opportunity, route class, edge, eligibility и lifecycle state.
* risk\_decisions — итог risk evaluation, reason codes, size, mode и anomaly flags.
* capital\_reservations — резерв капитала, expires\_at, bucket, plan\_id и reservation token.
* exposure\_reservations — резерв экспозиции по токену, бирже, стратегии и сети.
* execution\_plans — план исполнения, policy-поля, version и lifecycle state.
* execution\_legs — ноги сделки, статусы, attempt\_number, external refs и timeouts.
* portfolio\_positions — канонические позиции и агрегированные exposure fields.
* token\_profiles — история trust, adaptive risk и lifecycle токена.
* route\_profiles — качество маршрутов, degradations, route trust и history.
* paper\_trades — virtual execution path, simulated fills, paper PnL и decision trace.
* outbox\_events — события на публикацию.
* inbox\_events — журнал обработанных входящих событий.
* audit\_log — операционный и доменный аудит.

## 20.1 Обязательные правила хранения

* Все изменяемые доменные агрегаты обязаны иметь version и optimistic concurrency check.
* Для критичных таблиц должна существовать политика TTL, если запись не является постоянной по природе.
* Локальные кэши execution worker не могут считаться источником истины.

# 21. Формальные схемы сообщений и событий

## 21.1 Обязательный envelope

Каждая команда и каждое событие должны содержать:

* message\_id
* correlation\_id
* causation\_id
* entity\_type
* entity\_id
* version
* source\_module
* event\_ts
* schema\_version

## 21.2 Минимальный набор команд

* EvaluateOpportunity
* EvaluateRisk
* ReserveCapital
* ReserveRiskWindow
* ArmPlan
* ExecutePlan
* ForceHedge
* ForceUnwind
* CommitFill
* ReleaseReserve
* ClosePosition
* SuspendToken
* PromoteTokenToLive

## 21.3 Минимальный набор событий

* SnapshotUpdated
* OpportunityDetected
* OpportunityExpired
* RiskDecisionIssued
* CapitalReserved
* PlanArmed
* LegSent
* LegPartiallyFilled
* LegFilled
* HedgeTriggered
* UnwindTriggered
* PositionClosed
* ReservationExpired
* ReconciliationMismatchDetected
* PaperTradeClosed

# 22. Межмодульные API-контракты

Для старта разработки нужно зафиксировать не только названия команд, но и минимальный контракт запрос-ответ между сервисами.

* EvaluateOpportunity: вход — market snapshot, route candidate, fees, gas; выход — edge, size envelope, route feasibility, anomaly flags.
* EvaluateRisk: вход — opportunity, token profile, route profile, portfolio state; выход — mode, risk reason codes, allowed size, trust result.
* ReserveCapital: вход — plan\_id, bucket, size, risk token; выход — reservation\_id, expires\_at, status.
* ArmPlan: вход — approved plan и reservation tokens; выход — execution plan, timeouts и policy fields.
* CommitFill: вход — plan\_id, leg\_id, fill payload; выход — position delta, capital delta, status.
* Для каждого контракта должна быть отдельно описана версия схемы, SLA ответа и поведение при retry.

# 23. Execution playbooks

## 23.1 Partial fill policy

Policy partial fill должна быть параметром ExecutionPlan, а не неявной логикой worker.

Минимально обязательные варианты:

* PartialFillImmediateHedge: хеджировать уже заполненный объем сразу, остаток отменить.
* PartialFillWaitAndHedge: подождать короткий timeout, затем хеджировать filled part и отменить remainder.
* PartialFillCancelAll: отменить обе стороны, если это еще возможно, и вернуть opportunity в pool или закрыть как rejected.

## 23.2 Hedge и unwind policy

* Для каждой стратегии должна быть задана first\_leg\_policy.
* Hedge policy обязана содержать fallback routes, max acceptable slippage и hard timeout.
* Unwind policy обязана содержать trigger по PnL, trigger по timeout и приоритет между ценой и скоростью выхода.

## 23.3 Сценарии, которые должны быть описаны явно

* Первая нога fill, вторая rejected.
* Первая нога partial fill, вторая не стартовала.
* Ордер acknowledged, но не приходит fill.
* DEX tx зависла в mempool.
* DEX tx reverted.
* Повторный ack или duplicate fill event.
* Late fill после перехода к hedge.

# 24. Консистентность, резервирование и failover

## 24.1 Reservation-first protocol

* Сначала ReserveCapital и ReserveRiskWindow.
* Только после успешного резервирования разрешается ArmPlan.
* Без reservation token исполнение запрещено.
* CommitFill и ReleaseReserve всегда привязаны к конкретному plan\_id.

## 24.2 Минимальный protocol failover

* Должен существовать явный механизм leader election.
* Должен существовать fencing token или эквивалентная защита от dual writes.
* Новый лидер входит в recovery mode, а не в normal mode.
* До завершения recovery новые live-сделки запрещены.

## 24.3 Reconciliation playbook

Нужно явно описать, что делать, если:

* system.state = pending, а venue = filled
* system.state = filled, а venue = pending
* portfolio считает одну экспозицию, а execution timeline другую
* expired reservation не была освобождена вовремя

# 25. Risk formulas и sizing rules

## 25.1 Dynamic sizing

Фиксированный max trade notional недостаточен. Для разработки нужно ввести адаптивную формулу размера.

Практическое правило:

* maxTradeNotional ограничивается минимумом из четырех величин:
* доступный капитал в рамках portfolio cap;
* ликвидность первой ноги в пределах допустимого slippage;
* ликвидность второй ноги в пределах допустимого slippage;
* venue.maxOrderSize.

## 25.2 Иерархия лимитов

* per trade
* per token
* per venue
* per network
* per strategy
* per portfolio

## 25.3 Correlation и aggregate exposure

Нужно явно описать:

* как считается совокупная экспозиция по токену
* как учитываются коррелированные активы
* как происходит пересчет exposure при concurrent сделках
* как paper trade влияет на adaptive risk и как не подменяет боевую статистику

# 26. Observability, алерты и operator runbooks

## 26.1 Минимальные метрики

* opportunities\_queue\_depth
* risk\_eval\_p95\_ms
* execution\_send\_p95\_ms
* stale\_snapshot\_ratio
* capital\_reserved\_ratio
* reconciliation\_mismatch\_total
* paper\_vs\_live\_drift
* token\_quality\_score

## 26.2 Минимальные алерты

* stale data на hot-tier токене
* capital leak или reservation buildup
* reconciliation mismatch
* repeated hedge/unwind trigger
* route degradation
* risk engine unavailable
* paper/live drift выше порога

## 26.3 Operator runbooks

Нужно формально описать шаги при:

* подвисшем резерве
* stuck execution leg
* route degradation
* force unwind
* отказе лидера
* резком росте error rate по токену или маршруту

# 27. Deployment topology

## 27.1 Разделение зон

* Market intake zone
* Decision zone
* Execution zone
* Control and observability zone
* Storage zone

## 27.2 Stateful vs stateless

Нужно явно указать:

* какие сервисы stateless
* какие сервисы stateful
* где их authoritative storage
* как они масштабируются
* какие очереди и worker pools используются

## 27.3 Partitioning и backpressure

Для старта разработки нужно определить:

* ключ partitioning
* hot / warm / cold tiers
* bounded queue policy
* backpressure policy
* bulkhead boundaries между execution, analytics и paper trading

# 28. Минимальный backlog первой стадии разработки

## 28.1 P0 — без этого live стартовать нельзя

* Canonical market model
* Edge collectors
* Strategy intelligence
* Risk and trust engine
* Capital reservation
* ExecutionPlan / ExecutionLeg state machine
* Outbox / inbox
* Reconciliation loop
* Audit trail

## 28.2 P1 — нужно для controlled production

* TokenProfile и RouteProfile
* Adaptive risk
* Dynamic sizing
* Partial fill playbooks
* Operator dashboards
* Alerts and tracing

## 28.3 P2 — расширение качества и coverage

* Paper token discovery
* Auto-tiering watchlist
* Route scoring history
* Quality-based token promotion to live
* Recalibration jobs

# 29. Итог implementation-ready редакции

* Все материалы v0.8 сохранены без исключения.
* Поверх исходной архитектуры добавлен слой инженерной конкретики, необходимый для старта разработки.
* Теперь документ задает не только доменную карту системы, но и набор обязательных решений по SLA, состояниям, данным, сообщениям, execution semantics, отказам и backlog первого этапа.
* Следующий шаг после этой редакции — собрать уже не архитектурный документ, а реализационный пакет: service contracts, DB schema draft, event payload schemas и runbooks по инцидентам.

# 30. Принципы реализационного пакета

Данный слой документа не заменяет архитектуру и не переписывает ранее зафиксированные решения. Он продолжает уже существующую структуру и доводит ее до уровня, на котором команда может разбирать проект на конкретные сервисы, схемы хранения, события, API и рабочие пакеты разработки.

* Все ранее описанные модули сохраняются и используются как основа для сервисной декомпозиции.
* Все схемы ниже являются draft-уровнем: их можно уточнять, но нельзя игнорировать как необязательные идеи.
* Любая дальнейшая детализация должна оставаться совместимой с уже зафиксированными state machines, ownership rules, reservation-first protocol и paper trading контуром.

# 31. Service decomposition

## 31.1 Сервисы первой волны

* Market Intake Service — отвечает за ingestion быстрых snapshots, rate-limit профили и publish normalized market updates.
* Canonical Market Service — отвечает за справочник рынков, токенов, сетей, маршрутов, единиц измерения и route resolution.
* Opportunity Service — отвечает за evaluate opportunity, enrichment, ranking и lifecycle самой opportunity.
* Risk Service — отвечает за limit checks, trust decisions, anomaly flags, mode selection и risk decision issuance.
* Capital Service — отвечает за capital reservations, exposure reservations, release, commit и capital visibility.
* Execution Orchestrator Service — отвечает за ExecutionPlan, ExecutionLeg, timeout profile, partial fill policy и выбор hedge/unwind действий.
* Venue Adapter Services — отвечают за интеграции с CEX, DEX, RPC, bridges и их локальные retry / error semantics.
* Portfolio Service — отвечает за позиции, aggregate exposure, realized/unrealized PnL и portfolio views.
* Paper Trading Service — отвечает за виртуальные сделки, paper-only статистику и token discovery в paper контуре.
* Reconciliation Service — отвечает за сверку system state и external confirmations.
* Observability Service — отвечает за audit log, metrics, traces, timeline сборку и operator-facing diagnostics.
* Control Plane Service — отвечает за configuration, secrets, feature flags, emergency switches и rollout orchestration.

## 31.2 Stateful и stateless сервисы

* Market Intake Service — stateful по кэшу и latency profile, но с вынесенным authoritative publish log.
* Canonical Market Service — stateful, authoritative owner registry-данных.
* Opportunity Service — stateful по lifecycle opportunities и scoring.
* Risk Service — stateful, authoritative owner risk decisions, token/route profiles и limit state.
* Capital Service — stateful, authoritative owner reservations и bucket capital state.
* Execution Orchestrator Service — stateful, authoritative owner plan execution state.
* Venue Adapter Services — преимущественно stateless по бизнес-логике, но с локальным operational state по connection pools, request budget и external acknowledgments cache.
* Portfolio Service — stateful, authoritative owner canonical portfolio positions.
* Paper Trading Service — stateful, но полностью изолирован от live capital state.

# 32. Boundaries ответственности между сервисами

## 32.1 Что сервис может делать сам

* Opportunity Service может создавать и обновлять opportunity state, но не может резервировать капитал.
* Risk Service может одобрять или блокировать opportunity, но не может напрямую отправлять ордера.
* Capital Service может резервировать и освобождать капитал, но не может менять execution state.
* Execution Orchestrator может менять state plan и leg, но не может самовольно переписывать portfolio positions.
* Portfolio Service может обновлять portfolio positions только на основании подтвержденных fill-событий и compensating actions.

## 32.2 Что сервису запрещено

* Venue Adapter не может создавать новую позицию в портфеле.
* Execution worker не может напрямую писать в token profile.
* Paper Trading Service не может использовать live reservations и live capital bucket.
* Control Plane не может подменять доменные решения задним числом без audit log и explicit operator action.

# 33. Draft DB schema

## 33.1 market\_snapshots

Обязательные поля:

* snapshot\_id
* source\_id
* market\_id
* bid\_price
* ask\_price
* mid\_price
* bid\_size
* ask\_size
* source\_timestamp
* ingest\_timestamp
* publish\_timestamp
* freshness\_state
* schema\_version

## 33.2 arbitrage\_opportunities

Обязательные поля:

* opportunity\_id
* route\_id
* strategy\_id
* lifecycle\_state
* gross\_edge\_bps
* net\_edge\_bps
* fees\_estimate
* slippage\_budget\_bps
* data\_freshness\_state
* anomaly\_state
* created\_at
* updated\_at
* version

## 33.3 risk\_decisions

Обязательные поля:

* risk\_decision\_id
* opportunity\_id
* mode
* allowed\_notional
* reason\_codes\_json
* risk\_step
* token\_profile\_version
* route\_profile\_version
* anomaly\_flags\_json
* issued\_at
* version

## 33.4 capital\_reservations

Обязательные поля:

* reservation\_id
* plan\_id
* capital\_bucket\_id
* reserved\_notional
* reservation\_token
* lifecycle\_state
* expires\_at
* created\_at
* released\_at
* version

## 33.5 exposure\_reservations

Обязательные поля:

* exposure\_reservation\_id
* plan\_id
* asset\_key
* venue\_key
* network\_key
* exposure\_delta
* expires\_at
* lifecycle\_state
* created\_at
* version

## 33.6 execution\_plans

Обязательные поля:

* plan\_id
* opportunity\_id
* risk\_decision\_id
* lifecycle\_state
* first\_leg\_policy
* partial\_fill\_policy
* hedge\_policy\_json
* unwind\_policy\_json
* timeout\_profile\_json
* created\_at
* updated\_at
* version

## 33.7 execution\_legs

Обязательные поля:

* leg\_id
* plan\_id
* leg\_role
* venue\_id
* instrument\_id
* side
* notional
* lifecycle\_state
* attempt\_number
* idempotency\_key
* external\_order\_id
* tx\_hash
* status\_reason
* sent\_at
* last\_update\_at
* version

## 33.8 portfolio\_positions

Обязательные поля:

* position\_id
* portfolio\_id
* asset\_key
* venue\_key
* network\_key
* strategy\_class
* lifecycle\_state
* gross\_exposure
* net\_exposure
* realized\_pnl
* unrealized\_pnl
* updated\_at
* version

## 33.9 token\_profiles

Обязательные поля:

* token\_profile\_id
* token\_id
* lifecycle\_state
* trade\_count
* paper\_trade\_count
* avg\_pnl\_bps
* winrate
* drawdown\_bps
* trust\_state
* anomaly\_state
* adaptive\_risk\_step
* updated\_at
* version

## 33.10 paper\_trades

Обязательные поля:

* paper\_trade\_id
* opportunity\_id
* token\_id
* route\_id
* lifecycle\_state
* simulated\_entry
* simulated\_exit
* simulated\_pnl
* decision\_trace\_json
* created\_at
* closed\_at
* version

# 34. Event payload drafts

## 34.1 SnapshotUpdated

Минимальный payload:

* event\_id
* event\_type = SnapshotUpdated
* snapshot\_id
* market\_id
* source\_id
* freshness\_state
* publish\_timestamp
* schema\_version

## 34.2 OpportunityDetected

Минимальный payload:

* event\_id
* opportunity\_id
* strategy\_id
* route\_id
* gross\_edge\_bps
* net\_edge\_bps
* anomaly\_state
* created\_at
* schema\_version

## 34.3 RiskDecisionIssued

Минимальный payload:

* event\_id
* risk\_decision\_id
* opportunity\_id
* mode
* allowed\_notional
* reason\_codes\_json
* issued\_at
* schema\_version

## 34.4 CapitalReserved

Минимальный payload:

* event\_id
* reservation\_id
* plan\_id
* capital\_bucket\_id
* reserved\_notional
* expires\_at
* schema\_version

## 34.5 PlanArmed

Минимальный payload:

* event\_id
* plan\_id
* opportunity\_id
* first\_leg\_policy
* partial\_fill\_policy
* timeout\_profile\_json
* armed\_at
* schema\_version

## 34.6 LegFilled

Минимальный payload:

* event\_id
* plan\_id
* leg\_id
* external\_order\_id\_or\_tx\_hash
* filled\_notional
* avg\_fill\_price
* fill\_timestamp
* schema\_version

## 34.7 ReconciliationMismatchDetected

Минимальный payload:

* event\_id
* plan\_id
* mismatch\_type
* system\_state\_snapshot\_json
* external\_state\_snapshot\_json
* detected\_at
* severity
* schema\_version

# 35. HTTP / RPC contract skeletons

## 35.1 Opportunity Service

* POST /evaluate-opportunity
* GET /opportunity/{id}
* POST /expire-opportunity
* GET /opportunity/{id}/timeline

## 35.2 Risk Service

* POST /evaluate-risk
* GET /risk-decision/{id}
* POST /suspend-token
* POST /update-token-profile

## 35.3 Capital Service

* POST /reserve-capital
* POST /release-reserve
* POST /commit-fill
* GET /capital-bucket/{id}

## 35.4 Execution Orchestrator Service

* POST /arm-plan
* POST /execute-plan
* POST /force-hedge
* POST /force-unwind
* GET /execution-plan/{id}
* GET /execution-plan/{id}/legs

## 35.5 Reconciliation Service

* POST /run-reconciliation
* GET /mismatch/{id}
* POST /resolve-mismatch

# 36. Retry, idempotency и timeout policy

## 36.1 Retry policy

* Retry допускается только для идемпотентных команд и сетевых ошибок, где эффект на внешнем мире не подтвержден.
* Retry не должен создавать вторую сделку, второй резерв или второй force unwind.
* Для внешних venue-команд обязателен idempotency key или другой детерминированный идентификатор.

## 36.2 Timeout policy

* Timeout должен существовать у каждой синхронной команды.
* Timeout profile должен быть частью ExecutionPlan для execution-путей и частью contract spec для межсервисных запросов.
* Истекший timeout не означает автоматическую отмену внешнего эффекта; после timeout всегда нужен explicit status check.

# 37. Operator runbooks — детализированная первая версия

## 37.1 Подвисший резерв

Шаги:

1. Проверить reservation state, expires\_at и связанные execution plans.
2. Проверить, был ли CommitFill или ReleaseReserve потерян в outbox.
3. Если резерв expired и не связан с активной ногой, выполнить safe release.
4. Записать audit событие и пересчитать capital view.

## 37.2 Stuck execution leg

Шаги:

1. Проверить последний подтвержденный статус ноги.
2. Выполнить explicit status refresh на venue.
3. Если внешнего исполнения нет — перейти к cancel / retry policy.
4. Если внешнее исполнение есть — обновить leg state и пересчитать hedge/unwind requirement.

## 37.3 Route degradation

Шаги:

1. Проверить route health сигналы, gas / RPC / bridge diagnostics.
2. Перевести route profile в degraded или suspended.
3. Остановить новые планы по маршруту.
4. Для активных планов запустить re-evaluate или unwind policy.

## 37.4 Отказ лидера

Шаги:

1. Активировать leader election protocol.
2. Перевести систему в recovery mode.
3. Запретить новые live execution plans.
4. Выполнить reconciliation активных reservations и in-flight legs.
5. Разрешить выход из recovery только после health-check critical state.

# 38. Rollout plan по стадиям

## 38.1 Stage A — foundation

* Canonical market model
* market snapshots
* opportunity lifecycle
* risk decision issuance
* capital reservation
* execution plan lifecycle

## 38.2 Stage B — controlled execution

* venue adapters
* commit / release / reconciliation
* operator dashboards
* audit log
* alerts and traces

## 38.3 Stage C — learning loop

* token profile evolution
* route profile evolution
* paper token discovery
* recalibration jobs
* adaptive sizing refinement

# 39. Рабочие пакеты команды разработки

## 39.1 Backend domain package

* domain models
* state transitions
* validation rules
* persistence contracts

## 39.2 Execution package

* orchestrator
* leg state tracking
* timeout engine
* hedge/unwind policy executors

## 39.3 Risk and capital package

* risk decision engine
* capital reservation
* exposure reservation
* token / route profiles

## 39.4 Platform package

* messaging
* outbox / inbox
* observability
* control plane
* deployment automation

# 40. Definition of done для первой production-ready фазы

Фаза считается завершенной только если:

* все критичные state transitions покрыты тестами;
* reservation-first protocol проверен на race conditions;
* duplicate events не удваивают доменный эффект;
* reconciliation умеет разбирать как минимум базовые mismatch cases;
* paper trading не влияет на live capital и live positions;
* observability показывает таймлайн сделки от snapshot до closed state;
* operator runbooks отработаны хотя бы на tabletop-сценариях.

# 41. Итог реализационного пакета

* Существующая архитектурная структура полностью сохранена.
* Поверх нее добавлен следующий уровень детализации: сервисы, черновые схемы таблиц, минимальные payload-контракты, HTTP / RPC skeletons, retry semantics, runbooks и rollout plan.
* Этот документ уже можно использовать как базу для распределения задач между backend, integration, platform и operator tooling потоками.
* Следующий уровень детализации после этой версии — уже проектные артефакты уровня engineering docs: SQL schema, OpenAPI / AsyncAPI, sequence diagrams и task-level backlog по спринтам.

# 42. OpenClaw как внешний operator и automation layer

OpenClaw должен встраиваться в Arbibot 2 не как источник истины для портфеля, резервов и execution state, а как внешний self-hosted agent layer для операторского доступа, workflows, наблюдаемости и автоматизации процедур ([OpenClaw docs](https://docs.openclaw.ai), [getting started](https://github.com/openclaw/openclaw/blob/main/docs/start/getting-started.md)).

* OpenClaw представляет собой self-hosted gateway, который может работать на отдельной машине или сервере и подключать Telegram, WhatsApp, Discord, iMessage и другие каналы к агентному контуру ([OpenClaw docs](https://docs.openclaw.ai)).
* OpenClaw имеет browser dashboard / Control UI, sessions, memory/skills и multi-agent routing, поэтому его разумно использовать как операторскую и automation-надстройку, а не как замену доменных сервисов Arbibot 2 ([OpenClaw docs](https://docs.openclaw.ai)).
* Для запуска OpenClaw рекомендуются Node 24 или Node 22 LTS, onboarding через openclaw onboard –install-daemon и локальный Control UI по адресу http://127.0.0.1:18789/ на хосте gateway ([OpenClaw docs](https://docs.openclaw.ai), [getting started](https://github.com/openclaw/openclaw/blob/main/docs/start/getting-started.md)).

# 43. Принципы встраивания OpenClaw в проект

* OpenClaw не владеет капиталом, позициями, reservations, execution state и risk decisions. Он может инициировать workflows и запросы, но authoritative state остается внутри Arbibot 2.
* OpenClaw должен обращаться к Arbibot 2 только через явные API, operator endpoints, read-only dashboards и строго ограниченные action endpoints.
* Любая команда, пришедшая из OpenClaw, должна проходить ту же авторизацию, аудитную запись и policy validation, что и команда, пришедшая из web UI или operator console.
* OpenClaw должен использоваться для orchestrated workflows: incident intake, runbook assistance, report generation, querying dashboards, безопасное переключение режимов, а не для прямой записи в БД.

# 44. Точки интеграции OpenClaw с модулями Arbibot 2

## 44.1 Control plane

* OpenClaw может запрашивать текущую конфигурацию, feature flags, rollout status и режимы работы.
* OpenClaw может инициировать безопасные control plane команды: перевести систему в safe mode, выключить paper trading, запросить rotate secrets, но только через approve-required actions.

## 44.2 Observability and audit

* OpenClaw может читать audit trail, alert feed, traces, execution timelines и operator summaries.
* OpenClaw может агрегировать инциденты и превращать их в operator-ready brief, но не переписывать audit log.

## 44.3 Operator experience

* OpenClaw может быть внешним conversational интерфейсом к операторскому контуру, позволяя спрашивать про позиции, execution failures, token status и состояние маршрутов из мессенджеров.
* OpenClaw может инициировать pre-filled runbooks и incident checklists.

## 44.4 Paper trading

* OpenClaw может запускать workflow анализа новых токенов, собирать paper summaries, предлагать кандидатов на live review и рассылать operator digests.

## 44.5 Reconciliation и runbooks

* OpenClaw может сопровождать оператора по шагам reconciliation, failover recovery и postmortem preparation.
* OpenClaw не должен сам принимать окончательное решение по manual review cases без явного operator approval.

# 45. OpenClaw integration architecture

## 45.1 Отдельный integration boundary

Для OpenClaw должен существовать выделенный integration boundary:

* OpenClaw Gateway Layer
* OpenClaw Skills / Agent Workflows Layer
* Arbibot Operator API Layer
* Arbibot Read Models and Action Endpoints

## 45.2 Что должно быть доступно через Operator API

* GET /operator/portfolio-summary
* GET /operator/execution/{id}
* GET /operator/token/{id}
* GET /operator/route/{id}
* GET /operator/incidents
* POST /operator/safe-mode
* POST /operator/paper/pause
* POST /operator/paper/resume
* POST /operator/runbook/start
* POST /operator/report/generate

## 45.3 What OpenClaw must not do

* Не писать напрямую в risk\_decisions
* Не писать напрямую в capital\_reservations
* Не писать напрямую в execution\_plans
* Не писать напрямую в portfolio\_positions
* Не обходить control plane approvals

# 46. OpenClaw sessions, channels и use cases

OpenClaw sessions должны быть привязаны к operator persona, channel type и permission scope, потому что сам gateway строится вокруг сессий, многоагентной маршрутизации и channel connectivity ([OpenClaw docs](https://docs.openclaw.ai)).

## 46.1 Базовые use cases

* Telegram / Discord operator assistant
* Incident triage assistant
* Paper trading daily digest
* Token promotion review assistant
* Reconciliation briefing assistant
* Deployment and rollout checklist assistant

## 46.2 Session isolation

* Отдельные session scopes для продакшена, paper, staging и sandbox.
* Отдельные skill sets для read-only workflows и action workflows.
* Отдельные approval policies для destructive или sensitive actions.

# 47. Security model для OpenClaw integration

* OpenClaw gateway должен быть self-hosted в отдельной доверенной зоне, а не на том же хосте, где хранится весь critical state Arbibot.
* Доступ OpenClaw к Arbibot API должен быть ограничен сервисным токеном с минимальными правами.
* Action endpoints должны требовать signed approvals, role-based authorization и audit logging.
* Для production commands через OpenClaw рекомендуется two-step flow: запрос команды → preview эффекта → operator confirmation → execution.

# 48. Operational scenarios с OpenClaw

## 48.1 Incident summary

* OpenClaw получает alert event из alerting feed.
* Запрашивает related execution timeline и route diagnostics.
* Формирует короткий incident brief для оператора.
* При необходимости запускает runbook walkthrough.

## 48.2 Paper trading digest

* OpenClaw получает daily paper summary.
* Формирует shortlist токенов для candidate-live review.
* Прикладывает risk notes, route quality и drift between paper and live.

## 48.3 Safe mode command

* Оператор пишет команду в поддерживаемый канал.
* OpenClaw запрашивает текущий system status и impact preview.
* После подтверждения вызывает POST /operator/safe-mode.
* Команда фиксируется в audit trail.

# 49. Финализация документационного пакета

* Основная архитектура сохранена и продолжена без удаления элементов.
* OpenClaw встроен как отдельный self-hosted operator и automation layer, а не как источник истины для торговой системы ([OpenClaw docs](https://docs.openclaw.ai)).
* Для проекта дополнительно существуют отдельный документ по стеку и отдельная фронтенд-спецификация.
* Следующий шаг после этой финализации — перейти к engineering assets: SQL schema, OpenAPI / AsyncAPI и task-level sprint plan.

# 50. Дорожная карта разработки

Этот раздел не заменяет уже существующие backlog, rollout plan и working packages, а связывает их в единую дорожную карту проекта.

## 50.1 Цели дорожной карты

* Дать команде последовательность внедрения без разрыва между архитектурой и реализацией.
* Удержать paper trading, operator tooling и OpenClaw integration в общем плане, а не как поздние дополнения.
* Развести foundation, controlled execution, wide coverage и operator automation по стадиям зрелости.

## 50.2 Phase 0 — подготовка и архитектурная фиксация

Цель: закрыть пробелы между архитектурой и engineering execution.

В эту фазу входят:

* фиксация service boundaries;
* фиксация state machines;
* SQL schema draft;
* OpenAPI / AsyncAPI draft;
* operator action approval model;
* security baseline для OpenClaw integration.

Definition of done:

* все доменные агрегаты имеют owner, lifecycle и persistence contract;
* все критичные события имеют payload draft;
* все destructive operator actions имеют approval flow.

## 50.3 Phase 1 — foundation platform

Цель: поднять минимальный production-capable скелет системы.

В эту фазу входят:

* Canonical Market Model;
* Market Intake Service;
* Opportunity Service;
* Risk Service;
* Capital Service;
* Execution Orchestrator skeleton;
* outbox / inbox;
* observability baseline;
* базовый frontend dashboard.

Definition of done:

* opportunity проходит путь snapshot → risk → reserve → arm в тестовой среде;
* duplicate events не удваивают доменный эффект;
* базовые dashboards и audit timeline уже доступны оператору.

## 50.4 Phase 2 — controlled execution

Цель: получить controlled execution в ограниченном контуре.

В эту фазу входят:

* venue adapters первой волны;
* commit / release / reconciliation;
* execution policies и partial fill handling;
* portfolio updates;
* incident views и runbooks UI;
* alerting и tracing.

Definition of done:

* controlled live / staging execution проходит end-to-end;
* reconciliation разбирает базовые mismatch cases;
* operator может безопасно запускать runbooks.

## 50.5 Phase 3 — paper trading и token discovery

Цель: превратить paper trading в механизм расширения universe.

Для **первичного запуска** экземпляра системы paper trading — **обязательный предшественник** live: end-to-end проверка всего контура на виртуальном капитале, сбор статистики и отработка операторских сценариев; только затем live с минимальным капиталом (согласовано с `.cursor/plans/DEVELOPMENT_PLAN.md`, раздел «Операционная последовательность первичного запуска»).

В эту фазу входят:

* Paper Trading Service;
* token lifecycle console;
* paper dashboards;
* paper-only token discovery;
* token promotion workflow;
* paper-vs-live drift monitoring.

Definition of done:

* новые токены проходят discovery → paper-only → candidate-live;
* paper контур полностью изолирован от live capital;
* quality-based promotion decisions можно делать на основе накопленной истории.

## 50.6 Phase 4 — scalability and breadth

Цель: перейти от ограниченного watchlist к широкому coverage.

В эту фазу входят:

* hot / warm / cold tiers;
* partitioning и backpressure policy;
* route scoring history;
* replay layer;
* richer analytics и quality scoring;
* performance tuning для wide-universe monitoring.

Definition of done:

* система устойчиво работает на расширенном universe;
* degradation одного сегмента не ломает весь monitoring contour;
* operator видит coverage, throttling и degraded zones явно.

## 50.7 Phase 5 — OpenClaw-assisted operations

Цель: встроить OpenClaw в production workflows как безопасный operator layer.

В эту фазу входят:

* OpenClaw Gateway deployment;
* Operator API для OpenClaw;
* OpenClaw panel во фронтенде;
* incident briefing flows;
* report generation workflows;
* approval queue для OpenClaw-triggered actions.

Definition of done:

* OpenClaw умеет читать operator read models;
* OpenClaw умеет запускать approve-required workflows;
* ни одна команда из OpenClaw не обходит control plane policy.

## 50.8 Кросс-функциональные потоки работ

Дорожная карта должна вестись параллельно по четырем потокам:

* Domain backend
* Execution / integrations
* Platform / observability / security
* Frontend / operator tooling / OpenClaw surface

## 50.9 Риски дорожной карты

* Преждевременный переход к широкому universe без закрытия reconciliation и reservation hygiene.
* Слишком раннее подключение OpenClaw к action endpoints без approval model.
* Попытка строить live breadth раньше, чем paper trading станет надежным фильтром.
* Перекос в backend без operator surface и runbooks.

# 51. Матрица приоритетов по кварталам

## Q1 — foundation

* service boundaries
* schemas
* market intake
* risk / capital / execution skeleton
* basic frontend

## Q2 — controlled execution

* adapters
* reconciliation
* observability
* runbooks
* incident UI

## Q3 — paper expansion

* paper trading
* token lifecycle
* promotion workflows
* replay and analytics

## Q4 — breadth and operator automation

* wide-universe scaling
* route quality models
* OpenClaw workflows
* operator automation and digests

# 52. Гибкая система настроек и policy-конфигурации

Arbibot 2 должен быть управляем не только кодом и rollout-процедурами, но и явным слоем настроек. Этот слой не заменяет risk engine, control plane, TokenProfile, RouteProfile и strategy policies, а централизует все операционные пороги и флаги, которые должны настраиваться без изменения исходного кода.

## 52.1 Принципы слоя настроек

* Никакая критичная торговая логика не должна быть зашита только в код, если ее смысл — policy decision.
* Настройки должны иметь version, audit trail, owner и effective scope.
* Изменение настроек должно быть обратимым через rollback или возврат к предыдущей policy version.
* Для destructive и production-sensitive настроек должен существовать approval flow.

## 52.2 Основные группы настроек

* глобальные торговые настройки;
* настройки порога расхождения цен;
* настройки по классам арбитража;
* настройки по видам бирж и сетей;
* настройки risk и execution policy;
* настройки paper trading;
* настройки token lifecycle и token admission;
* настройки OpenClaw operator workflows.

# 53. Настройка минимального расхождения цен для арбитража

Это обязательная настройка. Система должна поддерживать явный конфиг, который запрещает открытие сделки, если абсолютное или нормализованное расхождение цен ниже заданного порога.

## 53.1 Обязательный параметр

* min\_arbitrage\_spread\_percent

Смысл параметра:

* если рассчитанное расхождение цен между ногами ниже этого процента, сделка не открывается;
* параметр должен применяться до стадии ArmPlan;
* параметр должен учитываться отдельно от fees, slippage и gas budget;
* после этого должен действовать и второй фильтр — минимальный net edge.

## 53.2 Рекомендуемая структура порогов

Нужно поддерживать не один глобальный порог, а иерархию:

* global minimum spread threshold;
* threshold per arbitrage class;
* threshold per token tier;
* threshold per venue pair;
* threshold per network;
* threshold per strategy.

Практическое правило разрешения конфликта:

* применяется наиболее строгий порог из всех релевантных настроек.

## 53.3 Связанные параметры

Помимо min\_arbitrage\_spread\_percent рекомендуется явно ввести:

* min\_net\_edge\_percent — минимальный edge после учета fees, slippage, gas и execution reserve;
* max\_allowed\_slippage\_percent — предельное допустимое отклонение исполнения;
* spread\_confirmation\_window\_ms — сколько времени spread должен подтверждаться, прежде чем opportunity считается валидной;
* spread\_anomaly\_multiplier — множитель для маркировки аномального спреда.

# 54. Независимые фильтры по видам арбитража

Система должна поддерживать независимое включение и выключение каждого вида арбитража. Это не только feature toggle, но и policy-layer, который влияет на discovery, paper и live независимо.

## 54.1 Обязательные флаги

Для каждого типа должны существовать отдельные флаги:

* enable\_spot\_spot
* enable\_spot\_futures
* enable\_futures\_futures
* enable\_futures\_spot
* enable\_dex\_futures
* enable\_funding\_arbitrage
* enable\_cex\_dex
* enable\_dex\_dex
* enable\_cex\_cex

## 54.2 Разделение по контурам

Каждый тип арбитража должен иметь как минимум три независимых флага:

* enabled\_for\_discovery
* enabled\_for\_paper
* enabled\_for\_live

Это позволяет, например:

* искать новые сценарии в discovery;
* гонять их в paper trading;
* не пускать их в live до отдельного допуска.

# 55. Независимые фильтры по видам бирж, сетей и источников

Нужно поддерживать независимые настройки того, что вообще участвует в наблюдении и исполнении.

## 55.1 Обязательные классы включения

* CEX tracking enabled / disabled
* DEX tracking enabled / disabled
* Futures venues enabled / disabled
* Spot venues enabled / disabled
* Funding sources enabled / disabled
* Bridges enabled / disabled
* Specific networks enabled / disabled
* Specific RPC providers enabled / disabled

## 55.2 Уровни применения

Настройки должны существовать как минимум на уровнях:

* глобально;
* по категории площадок;
* по конкретной бирже;
* по конкретной сети;
* по конкретному маршруту.

## 55.3 Разделение tracking и execution

Критически важно разделить:

* track\_enabled
* paper\_enabled
* live\_execution\_enabled

Например:

* биржа может быть включена для наблюдения, но выключена для live;
* сеть может быть включена в paper, но заблокирована для исполнения;
* конкретный bridge может наблюдаться, но не использоваться в маршрутах.

# 56. Дополнительные настройки, которые стоит добавить

## 56.1 Настройки token universe

* max\_tokens\_in\_hot\_tier
* max\_tokens\_in\_warm\_tier
* max\_tokens\_in\_cold\_tier
* auto\_promote\_to\_paper
* auto\_promote\_to\_candidate\_live
* auto\_suspend\_on\_quality\_drop

## 56.2 Настройки execution policy

* default\_first\_leg\_policy
* default\_partial\_fill\_policy
* default\_hedge\_timeout\_ms
* default\_unwind\_timeout\_ms
* cancel\_before\_hedge\_enabled
* allow\_force\_market\_exit

## 56.3 Настройки risk policy

* max\_trade\_notional\_percent
* max\_token\_exposure\_percent
* max\_venue\_exposure\_percent
* max\_network\_exposure\_percent
* manual\_review\_required\_above\_percent
* paper\_vs\_live\_drift\_limit

## 56.4 Настройки freshness и data quality

* max\_snapshot\_age\_ms
* max\_deepview\_age\_ms
* max\_route\_health\_age\_ms
* required\_sources\_count
* block\_on\_stale\_data

## 56.5 Настройки paper trading

* paper\_enabled\_global
* paper\_virtual\_capital\_per\_bucket
* paper\_candidate\_min\_history
* paper\_min\_hit\_rate\_for\_promotion
* paper\_min\_route\_stability\_for\_promotion
* paper\_drift\_alert\_enabled

## 56.6 Настройки OpenClaw

* openclaw\_readonly\_mode
* openclaw\_action\_approvals\_required
* openclaw\_channels\_enabled
* openclaw\_incident\_briefing\_enabled
* openclaw\_daily\_digest\_enabled

# 57. Архитектура хранения настроек

Настройки должны храниться как versioned policy objects, а не как набор случайных env-переменных.

## 57.1 Обязательные сущности

* ConfigProfile
* StrategyConfig
* RiskPolicyConfig
* ExecutionPolicyConfig
* VenueConfig
* NetworkConfig
* ArbitrageClassConfig
* PaperTradingConfig
* OpenClawConfig

## 57.2 Для каждой настройки нужно хранить

* config\_key
* value
* scope\_type
* scope\_id
* environment
* version
* created\_by
* approved\_by
* created\_at
* effective\_from
* rollback\_reference

## 57.3 Effective configuration resolution

При расчете effective settings рекомендуется такой порядок:

* global default
* environment override
* arbitrage class override
* venue / network override
* strategy override
* token tier override
* explicit route override

# 58. Runtime rules применения настроек

* Изменение конфигурации не должно ломать in-flight execution plans.
* Настройки discovery могут применяться почти мгновенно.
* Настройки live execution должны применяться через controlled reload.
* Критичные пороги и disable-флаги должны распространяться быстро и с подтверждением доставки.

## 58.1 Safe change policy

Для критичных настроек должен существовать как минимум один из режимов:

* dry-run preview
* staged rollout
* operator confirmation
* immediate emergency override

# 59. Что должен уметь видеть и менять оператор

Оператор должен видеть не только текущее значение настройки, но и:

* effective value;
* источник override;
* историю изменений;
* кто изменил настройку;
* где настройка влияет на execution и discovery;
* есть ли незавершенные approval requests.

# 60. Итог по слою настроек

* Гибкая система настроек становится отдельным слоем документации и проекта.
* Минимальный порог расхождения цен введен как обязательная policy-настройка.
* Независимые фильтры по видам арбитража и видам бирж введены как обязательные.
* Все настройки должны жить как versioned, auditable и rollbackable configuration layer.