# Outbox / Inbox pattern (P1-1.1-OIB)

## Scope (Phase 1 — текущая реализация)

- **Transactional outbox** пишется владельцем агрегата (например `risk-service` при `RiskDecisionIssued`).
- **Релей в `opportunity-service`:** поллинг `outbox_events`, доставка **только** события **`RiskDecisionIssued`** в домен возможностей (`arbitrage_opportunities` → `risk_checked`, `risk_decision_id`).
- События **`CapitalReserved`**, **`PlanArmed`** и прочие P0-facts в этой итерации **не** имеют отдельных publishers/consumers в релее; их добавление — следующий шаг архитектуры (Kafka/Redpanda + мульти-consumer).

## Outbox

- При изменении агрегата в **той же транзакции** вставляется строка в `outbox_events` с полным `envelope` и `payload`.
- Релей читает строки с `processed_at IS NULL` и **без** `relay_dead_letter_at`, с блокировкой `FOR UPDATE SKIP LOCKED`.
- **`processed_at` выставляется только после успешного применения** доменного эффекта (или идемпотентного подтверждения, что состояние уже соответствует событию).
- Неизвестный `event_type` → **dead-letter** (`relay_dead_letter_at` + причина), без `processed_at`.
- Целевой агрегат отсутствует (например возможность ещё не создана) → **retry** с увеличением `relay_delivery_attempts`, при превышении лимита → **dead-letter**; при откате попытки inbox-claim снимается, чтобы не блокировать повторную доставку.

## Inbox

- Перед обработкой входящего сообщения consumer выполняет `INSERT` в `inbox_events (consumer_id, message_id)`; при конфликте уникального ключа — дубликат доставки (идемпотентный путь: проверить домен и при необходимости завершить outbox).
- Бизнес-эффект выполняется только при согласованном состоянии inbox + домена; при несовместимости дубликата и домена — **dead-letter** с явной причиной.

## Идемпотентность

- `message_id` глобально уникален в outbox; повторная доставка не создаёт второй доменный эффект благодаря inbox на стороне получателя и идемпотентным проверкам состояния.

## Транспорт

- Сейчас: in-process / общая БД (поллинг). Подключение **Kafka/Redpanda** — отдельная итерация; семантика outbox/inbox сохраняется.
