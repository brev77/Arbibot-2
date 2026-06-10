# HERMES и границы Operator API (P0-0.3-OC)

Черновик границ для Phase 5 и согласования с §49 архитектуры и фронт-спекой (HERMES, Operator API).

Краткая сводка функций и сценариев: [HERMES-reference.md](HERMES-reference.md).

## HERMES не источник истины (SoT)

- **SoT** остаётся в доменных сервисах и PostgreSQL (агрегаты, audit, outbox). HERMES (или аналог LLM-ассистента) **не** принимает решений о капитале, риске, arm/execute и **не** пишет напрямую в таблицы домена.
- **Допустимые роли HERMES:** объяснение read-моделей, подсказки по runbook, черновики запросов оператора, которые всё равно проходят через обычные API с RBAC и approval (см. [`docs/operator-approval-flow.md`](operator-approval-flow.md)).

## Operator API и control plane

- **Чтение:** HERMES может вызывать только те read endpoints, которые уже доступны оператору с тем же уровнем роли (через тот же gateway/BFF, без обходного «админского» канала).
- **Запись:** любая мутация — только через публичные контракты сервисов (sync REST / очереди по архитектуре), с `correlation_id`, idempotency и audit. Запрет «скрытых» internal URL, не проходящих через policy и rate limits.
- **Запрет обхода policy control plane:** нельзя выдавать HERMES сервисный токен с правами шире, чем у роли `admin` на dashboard, без отдельного ADR и двухключевого согласования.

## Связь с UI

- Роут `/HERMES` в операторском UI — оболочка над тем же session/RBAC, что и остальные разделы; интеграция с gateway описывается при появлении реального HERMES adapter (Phase 5).

## Следующие шаги

- ADR: конкретный протокол (SSE/WebSocket), модель сессии, список allow-listed операций для ассистента.
- Тесты: регрессия «ассистент не может вызвать endpoint вне allow-list».
