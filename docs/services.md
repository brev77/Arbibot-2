# Карта сервисов первой волны (P0-0.1-SVCMAP)

Согласовано с архитектурой Arbibot 2: sync REST — первичный контракт для команд и чтения; асинхронные события — факты домена и интеграция; фоновые воркеры — BullMQ/Temporal (позже).

| Сервис | Владелец агрегатов (single-writer) | Sync API | События (publish) | Очереди / workers |
|--------|--------------------------------------|----------|-------------------|------------------|
| **canonical-market-service** | Instrument, Route, VenueRef | ResolveInstrument, ResolveRoute | SnapshotUpdated (косвенно через intake) | — |
| **market-intake-service** | MarketSnapshot (edge) | Health, admin | SnapshotUpdated | Ingest workers |
| **opportunity-service** | ArbitrageOpportunity | CRUD/list opportunities, evaluate hooks | OpportunityDetected, обновления lifecycle | Enrichment workers |
| **risk-service** (`apps/risk-service`) | RiskDecision; **token_profiles** / **route_profiles**; watchlist tier snapshots; route scoring history | `POST /evaluate-risk` (optional body `adaptiveRisk: true` — UTC-hour multiplier on profile caps), `GET /risk-decisions/:id`, `GET /policy/token-profiles`, `GET /policy/route-profiles`, `GET /policy/watchlist/tiers`, `GET /policy/route-scoring-history/:routeKey`, `GET /policy/phase2-readiness`, **`POST /policy/jobs/watchlist-tiering`**, **`POST /policy/jobs/route-scoring`** (internal job triggers; header `x-arbibot-job-trigger` + env `RISK_POLICY_JOB_TRIGGER_TOKEN`) | RiskDecisionIssued | — |
| **config-service** (`apps/config-service`) | PolicyConfiguration (`policy_configurations`, scope — миграция `020`) | `GET/POST/PUT` под `/policy/configurations` (в т.ч. effective, history, rollback) | — | Redis cache (read-through); мутации с записью в **audit-service** |
| **capital-service** | CapitalReservation | ReserveCapital, ReleaseReservation, GET | CapitalReserved, CapitalReleased | TTL expiry worker |
| **execution-orchestrator** | ExecutionPlan, ExecutionLeg | ArmPlan, ExecutePlan (Phase 2+), read APIs | PlanArmed, LegFilled, PlanCompleted, … | Execution workers |
| **audit** (модуль/сервис) | AuditLogEntry | Read API (оператор) | — | — |
| **reconciliation-service** | ReconciliationRun (Phase 2) | Triggers, status | ReconciliationMismatchDetected | Recon loops |
| **paper-trading-service** (`apps/paper-trading-service`) | PaperTrade, PaperPromotionCandidate, PaperDriftSample | `GET/POST/PATCH` под `/paper/*` (см. `PAPER_HTTP_ROUTES` в `@arbibot/contracts`) | события paper — по мере внедрения outbox | — |
| **outbox-kafka-bridge** (`packages/outbox-kafka-bridge`) | — (процесс доставки) | — | читает outbox → Kafka: `SnapshotUpdated`, `CapitalReserved`, `PlanArmed`, `LegFilled`, `PlanCompleted` | `npm run bus:publish` / `bus:consume` |

## Границы интеграции

- **Risk vs config (разные домены):** **risk-service** владеет профилями лимитов (**token_profiles** / **route_profiles**) и отдаёт их через `GET /policy/*`. **config-service** — single-writer для централизованных **policy configurations** (ключ–значение, версии, scope); чтение/запись для операторского UI через BFF (`CONFIG_API_BASE`). Пересечения по смыслу согласовывать в спеках; прямого дублирования таблиц нет.
- **Config → Audit:** мутации policy в config-service вызывают **AuditClientService** (append в audit-service), чувствительные ключи (`risk.*`, `execution.*`, `capital.*`) требуют `approveReason` в теле запроса.
- **Opportunity → Risk:** sync `EvaluateRisk` (или внутренний вызов) до перехода opportunity в `risk_checked`.
- **Opportunity → Paper (Phase 3, опционально):** при заданном `PAPER_TRADING_SERVICE_URL` вызов `POST /opportunities/:id/paper-enqueue` пишет строку в `outbox_events` (`PaperPromotionCandidateRequested`, колонка **`paper_enqueue_idempotency_key`** для дедупа необработанных повторов); **OutboxRelayService** после короткой транзакции с lock вызывает HTTP `POST /paper/promotion-candidates` и отдельной транзакцией фиксирует `processed_at` (single-writer очереди остаётся в paper БД).
- **Risk → Capital:** решение `approved` и reservation-first: Capital Service выдаёт reservation token до arm.
- **Capital + Risk → Orchestrator:** `link-reservation` / `arm` валидируют резервацию и решение по риску через **HTTP** владельцев (`GET /capital/reservations/:id`, `GET /risk-decisions/:id`), без чтения чужих таблиц из БД оркестратора; перед мутацией плана выполняется **двойной** GET резервации (смягчение TOCTOU). Базовые URL: `CAPITAL_SERVICE_BASE_URL` / `CAPITAL_SERVICE_URL`, `RISK_SERVICE_BASE_URL` / `RISK_SERVICE_URL` (дефолты локальной сетки портов). При разнесённых БД по сервисам это обязательный контракт; общая Postgres в dev не отменяет границу владения записью.
- **Все пишущие доменные операции:** запись в **outbox** в той же транзакции, что и изменение агрегата; релей в Kafka/Redpanda — отдельный процесс (P1-1.1-OIB). Phase 1: **in-DB релей `RiskDecisionIssued` → opportunity-service** и **публикация в Kafka** (`SnapshotUpdated`, `CapitalReserved`, `PlanArmed`, `LegFilled`, `PlanCompleted` через `@arbibot/outbox-kafka-bridge`); прочие события — по мере внедрения (см. `docs/outbox-inbox.md`).

## Идентификаторы

- Префиксы сервисов для логов и метрик: см. `@arbibot/contracts` (`SERVICE_IDS` — расширяется по мере добавления приложений).

## Tooling: Graphify (knowledge graph)

**Graphify** строит knowledge graph репозитория для анализа зависимостей и границ сервисов.

| Параметр | Значение |
|----------|----------|
| Пакет | `graphifyy` (pip) |
| Выходные файлы | `graphify-out/graph.json`, `graphify-out/GRAPH_REPORT.md` |
| Текущий размер | 1694 nodes, 1691 edges, 417 communities |
| CI job | `graphify-check` (non-blocking, артефакт 7 дней) |
| npm-скрипты | `npm run graphify:rebuild`, `npm run graphify:query`, `npm run graphify:report` |

Типичные проверки:
- Кто **пишет** данную сущность (single-writer validation)
- Какие сервисы зависят от shared package (boundary check)
- God nodes и community drift (refactoring candidates)

Полное руководство: [docs/graphify-guide.md](graphify-guide.md).

## Phase 0 — см. также

- [Security baseline](security-baseline.md) (P0-0.3-SEC)
- [HERMES и границы Operator API](HERMES-operator-boundaries.md) (P0-0.3-OC)
- [HERMES — справка по функциям и границам](HERMES-reference.md)

## Первичный запуск: paper → live

По канону продукта (**не** только Phase 3 roadmap): при **первом** выводе системы в эксплуатацию сначала режим **paper trading** — сквозная проверка всех сервисов и режимов на виртуальном капитале и сбор статистики; затем **live с минимальным капиталом**. **`paper-trading-service`** и operator UI **`/paper`** / **`/tokens`** поддерживают этот сценарий; детали и критерии перехода: [.cursor/plans/DEVELOPMENT_PLAN.md](../.cursor/plans/DEVELOPMENT_PLAN.md) («Операционная последовательность первичного запуска»), `!Arbibot_2_Architecture_v1_final_docs_settings.md` (§13, §50.5). Staged rollout policy-конфига (CFG-3): [cfg-3-staged-rollout.md](cfg-3-staged-rollout.md).
