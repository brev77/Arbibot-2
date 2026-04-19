# Карта сервисов первой волны (P0-0.1-SVCMAP)

Согласовано с архитектурой Arbibot 2: sync REST — первичный контракт для команд и чтения; асинхронные события — факты домена и интеграция; фоновые воркеры — BullMQ/Temporal (позже).

| Сервис | Владелец агрегатов (single-writer) | Sync API | События (publish) | Очереди / workers |
|--------|--------------------------------------|----------|-------------------|------------------|
| **canonical-market-service** | Instrument, Route, VenueRef | ResolveInstrument, ResolveRoute | SnapshotUpdated (косвенно через intake) | — |
| **market-intake-service** | MarketSnapshot (edge) | Health, admin | SnapshotUpdated | Ingest workers |
| **opportunity-service** | ArbitrageOpportunity | CRUD/list opportunities, evaluate hooks | OpportunityDetected, обновления lifecycle | Enrichment workers |
| **risk-service** (`apps/risk-service`) | RiskDecision | POST /evaluate-risk, GET /risk-decisions/:id | RiskDecisionIssued | — |
| **capital-service** | CapitalReservation | ReserveCapital, ReleaseReservation, GET | CapitalReserved, CapitalReleased | TTL expiry worker |
| **execution-orchestrator** | ExecutionPlan, ExecutionLeg | ArmPlan, ExecutePlan (Phase 2+), read APIs | PlanArmed, LegFilled, PlanCompleted, … | Execution workers |
| **audit** (модуль/сервис) | AuditLogEntry | Read API (оператор) | — | — |
| **reconciliation-service** | ReconciliationRun (Phase 2) | Triggers, status | ReconciliationMismatchDetected | Recon loops |
| **paper-trading-service** (`apps/paper-trading-service`) | PaperTrade, PaperPromotionCandidate, PaperDriftSample | `GET/POST/PATCH` под `/paper/*` (см. `PAPER_HTTP_ROUTES` в `@arbibot/contracts`) | события paper — по мере внедрения outbox | — |
| **outbox-kafka-bridge** (`packages/outbox-kafka-bridge`) | — (процесс доставки) | — | читает outbox → Kafka: `SnapshotUpdated`, `CapitalReserved`, `PlanArmed` | `npm run bus:publish` / `bus:consume` |

## Границы интеграции

- **Opportunity → Risk:** sync `EvaluateRisk` (или внутренний вызов) до перехода opportunity в `risk_checked`.
- **Opportunity → Paper (Phase 3, опционально):** при заданном `PAPER_TRADING_SERVICE_URL` вызов `POST /opportunities/:id/paper-enqueue` пишет строку в `outbox_events` (`PaperPromotionCandidateRequested`, колонка **`paper_enqueue_idempotency_key`** для дедупа необработанных повторов); **OutboxRelayService** после короткой транзакции с lock вызывает HTTP `POST /paper/promotion-candidates` и отдельной транзакцией фиксирует `processed_at` (single-writer очереди остаётся в paper БД).
- **Risk → Capital:** решение `approved` и reservation-first: Capital Service выдаёт reservation token до arm.
- **Capital + Risk → Orchestrator:** `link-reservation` / `arm` валидируют резервацию и решение по риску через **HTTP** владельцев (`GET /capital/reservations/:id`, `GET /risk-decisions/:id`), без чтения чужих таблиц из БД оркестратора; перед мутацией плана выполняется **двойной** GET резервации (смягчение TOCTOU). Базовые URL: `CAPITAL_SERVICE_BASE_URL` / `CAPITAL_SERVICE_URL`, `RISK_SERVICE_BASE_URL` / `RISK_SERVICE_URL` (дефолты локальной сетки портов). При разнесённых БД по сервисам это обязательный контракт; общая Postgres в dev не отменяет границу владения записью.
- **Все пишущие доменные операции:** запись в **outbox** в той же транзакции, что и изменение агрегата; релей в Kafka/Redpanda — отдельный процесс (P1-1.1-OIB). Phase 1: **in-DB релей `RiskDecisionIssued` → opportunity-service** и **публикация в Kafka** (`SnapshotUpdated`, `CapitalReserved`, `PlanArmed` через `@arbibot/outbox-kafka-bridge`); прочие события — по мере внедрения (см. `docs/outbox-inbox.md`).

## Идентификаторы

- Префиксы сервисов для логов и метрик: см. `@arbibot/contracts` (`SERVICE_IDS` — расширяется по мере добавления приложений).

## Phase 0 — см. также

- [Security baseline](security-baseline.md) (P0-0.3-SEC)
- [OpenClaw и границы Operator API](openclaw-operator-boundaries.md) (P0-0.3-OC)
- [OpenClaw — справка по функциям и границам](openclaw-reference.md)

## Первичный запуск: paper → live

По канону продукта (**не** только Phase 3 roadmap): при **первом** выводе системы в эксплуатацию сначала режим **paper trading** — сквозная проверка всех сервисов и режимов на виртуальном капитале и сбор статистики; затем **live с минимальным капиталом**. Будущий `paper-trading-service` и UI `/paper` поддерживают этот сценарий; детали и критерии перехода: [.cursor/plans/DEVELOPMENT_PLAN.md](../.cursor/plans/DEVELOPMENT_PLAN.md) («Операционная последовательность первичного запуска»), `!Arbibot_2_Architecture_v1_final_docs_settings.md` (§13, §50.5).
