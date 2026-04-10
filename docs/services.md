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
| **outbox-kafka-bridge** (`packages/outbox-kafka-bridge`) | — (процесс доставки) | — | читает outbox → публикует в Kafka API | `npm run bus:publish` / `bus:consume` |

## Границы интеграции

- **Opportunity → Risk:** sync `EvaluateRisk` (или внутренний вызов) до перехода opportunity в `risk_checked`.
- **Risk → Capital:** решение `approved` и reservation-first: Capital Service выдаёт reservation token до arm.
- **Capital + Risk → Orchestrator:** ArmPlan принимает валидные токены резерва и correlation id.
- **Все пишущие доменные операции:** запись в **outbox** в той же транзакции, что и изменение агрегата; релей в Kafka/Redpanda — отдельный процесс (P1-1.1-OIB). На старте Phase 1: **in-DB релей `RiskDecisionIssued` → opportunity-service** и опционально **публикация `SnapshotUpdated` → Kafka** (`@arbibot/outbox-kafka-bridge`); остальные события — по мере внедрения (см. `docs/outbox-inbox.md`).

## Идентификаторы

- Префиксы сервисов для логов и метрик: см. `@arbibot/contracts` (`SERVICE_IDS` — расширяется по мере добавления приложений).
