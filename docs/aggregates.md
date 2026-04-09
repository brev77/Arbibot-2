# Агрегаты: владелец, хранилище, concurrency (P0-0.1-AGG)

| Агрегат | Single-writer сервис | Хранилище (OLTP) | Optimistic concurrency |
|---------|----------------------|------------------|-------------------------|
| **ArbitrageOpportunity** | opportunity-service | `arbitrage_opportunities` | `entity_version` (integer), compare-and-set при переходах |
| **RiskDecision** | risk-service | `risk_decisions` | `entity_version`; новые решения — insert-only, правки политик — отдельный поток |
| **CapitalReservation** | capital-service | `capital_reservations` | `entity_version` + статус; истечение TTL — отдельный переход |
| **ExecutionPlan** | execution-orchestrator | `execution_plans` | `entity_version` на плане |
| **ExecutionLeg** | execution-orchestrator | `execution_legs` | `entity_version` на ноге; план — родитель |
| **OutboxEvent** | сервис-владелец агрегата | `outbox_events` | processed_at NULL → dispatch; идемпотентность на уровне consumer (inbox) |
| **InboxEvent** | consuming service | `inbox_events` | unique (consumer, message_id) |
| **AuditLogEntry** | audit writer (platform) | `audit_log` | append-only, без CAS |

## Правила

- Ни один сервис кроме владельца не мутирует строки агрегата напрямую в БД.
- Чтение кросс-сервисно — через API или материализованные проекции (Phase 2+).
- `correlation_id` и `causation_id` проходят через sync и события для трассировки.
