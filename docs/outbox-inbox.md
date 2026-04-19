# Outbox / Inbox pattern (P1-1.1-OIB)

## Scope (Phase 1 — текущая реализация)

- **Transactional outbox** пишется владельцем агрегата (например `risk-service` при `RiskDecisionIssued`, `capital-service` при `CapitalReserved`, `execution-orchestrator` при `PlanArmed`).
- **Релей в `opportunity-service`:** поллинг `outbox_events`, доставка **`RiskDecisionIssued`** в домен возможностей (`arbitrage_opportunities` → `risk_checked`, `risk_decision_id`) и **`PaperPromotionCandidateRequested`** → HTTP `POST` в `paper-trading-service` (очередь promotion, см. `docs/async-events.md`).
- События **`CapitalReserved`**, **`PlanArmed`**, **`LegFilled`**, **`PlanCompleted`** пишутся в outbox владельцами (оркестратор — последние два при fill / завершении плана) и публикуются на Kafka через `@arbibot/outbox-kafka-bridge` (см. «Транспорт»); отдельного in-DB relay под них нет. Прочие P0-facts по мере появления — отдельные шаги (publisher + транспорт/consumer).

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

### Paper promotion (`PaperPromotionCandidateRequested`)

- Релей в **`opportunity-service`** после короткой транзакции с **`FOR UPDATE SKIP LOCKED`** выполняет **HTTP POST** в **`paper-trading-service`** уже **вне** удержания DB-lock (затем отдельная транзакция выставляет `processed_at` или увеличивает `relay_delivery_attempts` / dead-letter). Тики `processBatch` **сериализуются** (`relayGate`), чтобы два параллельных poll не открыли второй HTTP по той же строке сразу после `commit`.
- Семантика доставки в paper — **at-least-once**: при сбое после успешного POST и до фиксации `processed_at` возможен **повторный POST**; **paper-service** идемпотентен по **`enqueueIdempotencyKey`** (частичный уникальный индекс в БД paper + обработка `23505`).
- Повторный **`POST /opportunities/:id/paper-enqueue`** с тем же ключом **не создаёт вторую необработанную** строку в `outbox_events`: колонка **`paper_enqueue_idempotency_key`** и частичный уникальный индекс (миграция **`018`**) плюс проверка перед `INSERT`.

## Транспорт

- **In-DB relay:** `opportunity-service` поллит `RiskDecisionIssued` и `PaperPromotionCandidateRequested` (см. выше).
- **Kafka/Redpanda (dev):** пакет `@arbibot/outbox-kafka-bridge` публикует в топик строки с `event_type` в наборе **`SnapshotUpdated`**, **`CapitalReserved`**, **`PlanArmed`**, **`LegFilled`**, **`PlanCompleted`** (полный JSON `envelope` в значении сообщения). In-DB relay в `opportunity-service` фильтрует только свои `event_type` и не трогает эти строки. После успешного `producer.send` в той же транзакции выставляется `processed_at` (строка считается доставленной на шину; повторная публикация при сбое до commit допускается — consumer идемпотентен через inbox).
- **Smoke-consumer** в том же пакете: читает топик, парсит `envelope.messageId`, выполняет `tryClaimInboxMessage` с `consumer_id` по умолчанию `outbox-kafka-bridge-smoke` (без мутации чужих агрегатов). В топике могут быть разные `eventName` в envelope — smoke только фиксирует доставку через inbox.
- Compose: профиль `bus` в `infra/docker-compose.dev.yml` (Redpanda, порт **19092** на хосте). Переменные: `KAFKA_BROKERS`, `KAFKA_TOPIC` (по умолчанию `arbibot.domain.events`), `DATABASE_URL`. Скрипты: `npm run bus:publish`, `npm run bus:consume` из корня монорепо.

### Проверка `npm run bus:publish`

1. Поднять профиль `bus` и иметь мигрированный Postgres с непустыми строками `outbox_events` (`processed_at IS NULL`) для типов из фильтра bridge.
2. Задать `DATABASE_URL` и `KAFKA_BROKERS` (см. `.env.example`); без них скрипт завершится ошибкой.
3. Убедиться, что в сообщениях в топике у envelope присутствуют `messageId`, `eventName` / `event_type` согласно контракту; smoke-consumer (`npm run bus:consume`) логирует `eventName` и `entityType` при успешном inbox-claim.
