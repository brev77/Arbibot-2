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

- Поле `version` в envelope и `schema_version` в outbox — целое ≥ 1.
- **Minor** (обратно совместимые поля): можно не поднимать major при согласовании consumers.
- **Breaking**: инкремент major, параллельная поддержка двух payload версий в consumer до cutover.

## RiskDecisionIssued

Публикуется **risk-service** после фиксации `RiskDecision` в БД и записи в outbox (транзакция).

Payload (schema version 1): см. `packages/contracts/schemas/risk-decision-issued.payload.schema.json`.
