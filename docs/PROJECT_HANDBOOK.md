# Arbibot 2 — путеводитель по репозиторию

Сводная навигация для **разработчиков** и **операторов**. Детальные списки портов, скриптов и канон фаз остаются в [README.md](../README.md), [AGENTS.md](../AGENTS.md) и [.cursor/plans/DEVELOPMENT_PLAN.md](../.cursor/plans/DEVELOPMENT_PLAN.md); здесь — структура, инварианты в двух словах и ссылки на главы.

## Первые шаги

1. Прочитайте [главу 07 — секреты, настройка, мониторинг](handbook/07-secrets-config-and-monitoring.md) (куда класть чувствительные данные, слои настройки системы, за чем следить в смену).
2. Поднимите окружение по [главе 03](handbook/03-local-dev.md) и канону в README («Быстрый старт»).
3. Выберите дорожку ниже.

## Дорожка «Разработчик»

| Шаг | Документ |
|-----|----------|
| Обзор контура и сервисов | [01 — обзор системы](handbook/01-system-overview.md) |
| Инварианты (single-writer, outbox, reservation-first) | [02 — архитектура](handbook/02-architecture-invariants.md) |
| Локальная разработка | [03 — локальный старт](handbook/03-local-dev.md) |
| Тесты и CI / E2E | [04 — тестирование и CI](handbook/04-testing-and-ci.md) |
| Контракты | [docs/openapi-draft.yaml](openapi-draft.yaml), [docs/async-events.md](async-events.md), пакет `packages/contracts` |

Cursor: навыки ревью и архитектуры — [.cursor/skills/](../.cursor/skills/) (см. [AGENTS.md](../AGENTS.md)).

## Анализ кодовой базы (Graphify)

**Graphify** — knowledge graph репозитория для проверки границ сервисов, single-writer и shared-package зависимостей.

| Действие | Команда |
|----------|---------|
| Перестроить граф | `npm run graphify:rebuild` |
| Query к графу | `npm run graphify:query -- "вопрос"` |
| Показать отчёт | `npm run graphify:report` |

Полное руководство: [docs/graphify-guide.md](graphify-guide.md).

## Дорожка «Оператор»

| Шаг | Документ |
|-----|----------|
| Секреты, политики, сигналы смены | [07 — секреты, конфиг, мониторинг](handbook/07-secrets-config-and-monitoring.md) |
| Paper → live, UI, runbooks | [05 — оператор и runbooks](handbook/05-operator-runbooks.md) |
| Метрики, безопасность, SLO | [06 — observability и security](handbook/06-observability-security.md) |

## Оглавление глав (по порядку)

1. [Обзор системы](handbook/01-system-overview.md)
2. [Архитектурные инварианты](handbook/02-architecture-invariants.md)
3. [Локальная разработка](handbook/03-local-dev.md)
4. [Тестирование и CI](handbook/04-testing-and-ci.md)
5. [Оператор и runbooks](handbook/05-operator-runbooks.md)
6. [Observability и security](handbook/06-observability-security.md)
7. [Секреты, настройка системы, мониторинг](handbook/07-secrets-config-and-monitoring.md)

## Глоссарий (кратко)

- **Single-writer** — у каждой ключевой сущности один сервис-владелец мутаций.
- **Reservation-first** — сначала окна риска и резерв капитала, затем arm / исполнение.
- **Outbox / inbox** — доставка событий через БД и (частично) Kafka; см. [outbox-inbox.md](outbox-inbox.md).
- **Paper** — виртуальный контур для приёмки и статистики до live; канон в DEVELOPMENT_PLAN («Операционная последовательность первичного запуска»).
