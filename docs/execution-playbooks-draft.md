# Схема playbooks ExecutionPlan (P0-0.2-PLAY)

> ⚠️ **DRAFT / SUPERSEDED (2026-07-17):** это ранняя дизайн-версия (P0-0.2). Реализованная спецификация — [`partial-fill-playbooks.md`](partial-fill-playbooks.md) (`P2-2.2-PLAY`, миграция `025_execution_plan_playbook.sql`, `PartialFillPlaybookService`). Документ сохранён для истории дизайна.

Черновик конфигурации на уровне плана (§23): параметры partial fill, hedge, unwind задаются **JSON-схемой** в поле `playbook_config` (будущая колонка) или эквиваленте в `execution_plans.metadata`.

## Структура (версия 0)

```json
{
  "schemaVersion": 1,
  "onPartialFill": {
    "strategy": "pause_and_alert | auto_hedge | abort",
    "hedgeVenueRef": "optional-string"
  },
  "onTimeout": {
    "strategy": "unwind | alert_only"
  },
  "maxSlippageBps": 25
}
```

## Связь со state machine

- Переходы в `hedged` / `unwound` инициируются только после **impact preview** и **operator approval** (или автоматизированной политикой в Phase 2+ с audit).
- План хранит ссылку на активный playbook id + версию для воспроизводимости.
