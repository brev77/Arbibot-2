# Async события и envelope (P0-0.1-ASYNC)

JSON Schema для payload лежат в [`packages/contracts/schemas/`](../packages/contracts/schemas/). Имена событий — как в архитектуре: `SnapshotUpdated`, `OpportunityDetected`, `RiskDecisionIssued`, `CapitalReserved`, `PlanArmed`, `LegFilled`, `ReconciliationMismatchDetected`, `PlanCompleted`, `PositionClosed`.

## Envelope (каждое сообщение)

| Поле | Тип | Обязательно | Описание |
|------|-----|-------------|----------|
| messageId | string (uuid) | да | Уникум сообщения |
| correlationId | string | да | Сквозная корреляция |
| causationId | string | нет | id события-причины |
| entityType | string | да | Напр. RiskDecision |
| entityId | string | да | id сущности |
| version | integer | да | Версия payload схемы |
| sourceModule | string | да | risk-service, … |
| eventTs | string (ISO-8601) | да | Время факта |
| eventName | string | да | RiskDecisionIssued, … |
| payload | object | да | Тело по версии схемы |

Идемпотентность: consumer записывает `messageId` в `inbox_events` до обработки эффекта.

## Версионирование схем (P0-0.4-VER)

- Поле `version` в envelope и `schema_version` в outbox — целое ≥ 1; при записи в `outbox_events` они **совпадают** с версией JSON Schema payload для данного `event_type`.
- **Minor** (обратно совместимые поля): можно не поднимать `version` при согласовании всех consumers; при сомнении — инкремент и явная запись в changelog репозитория / ADR.
- **Breaking**: инкремент `version`, новая JSON Schema в `packages/contracts/schemas/`, параллельная поддержка двух payload версий в consumer до cutover; старые строки outbox остаются на прежней версии.
- **Sync REST / OpenAPI:** отдельная политика URL или заголовка версии API фиксируется при первом breaking HTTP-контракте (до этого — согласование DTO в `packages/contracts` и SemVer пакета `@arbibot/contracts`).

## RiskDecisionIssued

Публикуется **risk-service** после фиксации `RiskDecision` в БД и записи в outbox (транзакция).

Payload (schema version 1): см. `packages/contracts/schemas/risk-decision-issued.payload.schema.json`.

## SnapshotUpdated

Публикуется **market-intake-service** после применения снимка к `market_snapshots` и записи в outbox в той же транзакции (только если состояние изменилось и сгенерировано новое событие).

Payload (schema version 2): см. `packages/contracts/schemas/snapshot-updated.payload.schema.json`. Поля `envelope.version` и `outbox_events.schema_version` для этого события — **2**.

Обязательные поля payload: идентификатор снимка, venue, символ, `observedAt`, `receivedAt`, `entityVersion`, `staleAfterSeconds` (число секунд или `null`), `payload` (JSON объекта с площадки). Котировки и `canonicalInstrumentId` — опционально, если не заданы в снимке.

Транспорт: после записи в outbox процесс `@arbibot/outbox-kafka-bridge` может публиковать полный `envelope` в Kafka/Redpanda (топик по умолчанию `arbibot.domain.events`); см. `docs/outbox-inbox.md`.

## CapitalReserved

Публикуется **capital-service** после фиксации `CapitalReservation` в БД и записи в outbox в той же транзакции.

Payload (schema version 1): см. `packages/contracts/schemas/capital-reserved.payload.schema.json`.

## PlanArmed

Публикуется **execution-orchestrator** после успешного перехода плана в состояние `armed` и записи в outbox в той же транзакции.

Payload (schema version 1): см. `packages/contracts/schemas/plan-armed.payload.schema.json`.
