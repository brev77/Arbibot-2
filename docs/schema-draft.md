# Черновик SQL schema §20 (P0-0.1-SQL)

Имена и связи — уровень черновика; каноническая миграция: [`infra/postgres/migrations/001_core.sql`](../infra/postgres/migrations/001_core.sql).

## risk_decisions

| Колонка | Тип | Описание |
|---------|-----|----------|
| id | UUID PK | Идентификатор решения |
| correlation_id | TEXT NOT NULL | Сквозная корреляция |
| plan_reference | TEXT NOT NULL | Внешняя ссылка на план/возможность |
| outcome | TEXT NOT NULL | approved \| rejected \| deferred |
| reasons | JSONB NOT NULL | Массив строк причин |
| snapshot_version | INT NOT NULL | Версия снимка рынка |
| risk_mode | TEXT NOT NULL | fast \| standard \| conservative |
| entity_version | INT NOT NULL DEFAULT 1 | Optimistic lock |
| created_at | TIMESTAMPTZ NOT NULL | |

## arbitrage_opportunities

| Колонка | Тип | Описание |
|---------|-----|----------|
| id | UUID PK | |
| correlation_id | TEXT | |
| state | TEXT NOT NULL | detected \| enriched \| risk_checked \| … |
| payload | JSONB | Нормализованные поля возможности |
| entity_version | INT NOT NULL DEFAULT 1 | |
| created_at / updated_at | TIMESTAMPTZ | |

## capital_reservations

| Колонка | Тип | Описание |
|---------|-----|----------|
| id | UUID PK | reservation id |
| plan_id | UUID NULL | Связь с планом исполнения |
| correlation_id | TEXT NOT NULL | |
| amount_usd | NUMERIC | |
| state | TEXT NOT NULL | active \| released \| expired |
| expires_at | TIMESTAMPTZ | TTL |
| entity_version | INT NOT NULL DEFAULT 1 | |
| created_at | TIMESTAMPTZ | |

## execution_plans

| Колонка | Тип | Описание |
|---------|-----|----------|
| id | UUID PK | |
| correlation_id | TEXT | |
| state | TEXT NOT NULL | planned \| reserved \| armed \| executing \| completed \| … |
| capital_reservation_id | UUID NULL | |
| risk_decision_id | UUID NULL | |
| entity_version | INT NOT NULL DEFAULT 1 | |
| created_at / updated_at | TIMESTAMPTZ | |

## execution_legs

| Колонка | Тип | Описание |
|---------|-----|----------|
| id | UUID PK | |
| plan_id | UUID NOT NULL FK → execution_plans | |
| state | TEXT NOT NULL | created \| sent \| filled \| … |
| leg_index | INT NOT NULL | Порядок |
| entity_version | INT NOT NULL DEFAULT 1 | |
| created_at / updated_at | TIMESTAMPTZ | |

## outbox_events

| Колонка | Тип | Описание |
|---------|-----|----------|
| id | BIGSERIAL PK | |
| message_id | UUID NOT NULL UNIQUE | Идемпотентность доставки |
| event_type | TEXT NOT NULL | Напр. RiskDecisionIssued |
| entity_type | TEXT NOT NULL | |
| entity_id | TEXT NOT NULL | |
| schema_version | INT NOT NULL | Версия payload |
| payload | JSONB NOT NULL | Тело события |
| envelope | JSONB NOT NULL | correlationId, causationId, eventTs, sourceModule, … |
| created_at | TIMESTAMPTZ | |
| processed_at | TIMESTAMPTZ NULL | NULL = к отправке |

## inbox_events

| Колонка | Тип | Описание |
|---------|-----|----------|
| id | BIGSERIAL PK | |
| consumer_id | TEXT NOT NULL | Имя сервиса/подписки |
| message_id | UUID NOT NULL | |
| UNIQUE(consumer_id, message_id) | | Идемпотентность |
| payload_hash | TEXT | Опционально |
| received_at | TIMESTAMPTZ | |
| processed_at | TIMESTAMPTZ | |

## audit_log

| Колонка | Тип | Описание |
|---------|-----|----------|
| id | BIGSERIAL PK | |
| correlation_id | TEXT | |
| actor | TEXT NOT NULL | operator \| system \| service:id |
| action | TEXT NOT NULL | |
| resource_type | TEXT | |
| resource_id | TEXT | |
| payload | JSONB | До/после, diff |
| created_at | TIMESTAMPTZ NOT NULL | |
