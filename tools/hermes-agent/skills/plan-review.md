---
name: plan_review
description: "Обзор и анализ execution plans: список, детали конкретного плана, статус legs. Для команды /plans"
readonly: true
tools:
  - list_plans
  - get_plan
---

# Skill: plan-review

> **Обзор execution plans.** Команда `/plans` в Telegram и периодический review.
> Этот skill показывает планы и их статус; для arm/execute (мутации) см. security
> policy (требуют approval).

## Когда использовать

- Команда `/plans` в Telegram
- Оператор спрашивает: "какие планы?", "что исполняется?", "статус плана {{id}}?"
- Оператор хочет проверить, не зависли ли планы в `armed`/`executing`

## Trigger Patterns

- "plans", "планы", "исполнение"
- "какие планы активны", "что исполняется"
- "план {{id}}", "статус плана"
- "зависшие планы", "stuck plans"

## Последовательность вызовов

1. `list_plans` — получить список execution plans
   - Без фильтра → последние планы (newest-first)
   - Фильтр `status=armed` → планы, готовые к исполнению
   - Фильтр `status=executing` → планы в процессе
   - Фильтр `status=completed` → завершённые

2. Для конкретного плана: `get_plan` с `planId`
   - Возвращает plan + legs (статус каждого leg)
   - Показывает `state`, `createdAt`, `notionalUsd`, `legs[]`

3. Анализ:
   - Подсветить планы в `armed` дольше ожидаемого (возможно ждут approval)
   - Подсветить планы в `executing` дольше timeout (возможно зависли)
   - Подсветить failed legs

## Формат ответа (Telegram, кратко)

### Список планов:

```
📋 Execution plans (последние {{count}})

{{#each plans}}
{{status_emoji}} {{id}} — {{state}}
   {{instrument}}, ${{notional}}, {{legs_count}} legs
   Created: {{createdAt}}
{{/each}}

Legend: 🟢 completed | 🔵 executing | 🟡 armed | 🔴 failed
```

### Детали плана:

```
📋 Plan {{id}}

State: {{state}}
Instrument: {{instrument}}
Notional: ${{notional}}
Created: {{createdAt}}

Legs:
{{#each legs}}
  {{leg_status_emoji}} Leg {{index}}: {{venue}}, {{side}} {{qty}} @ {{price}}
     State: {{state}}
{{/each}}
```

## Guardrails

- **Read-only**: этот skill НЕ arm/execute/cancel планы
- Для arm → operator confirms через approval flow (не через этот skill)
- Для close position → отдельный flow (не здесь)
- Для мутаций плана оператор должен использовать UI `/execution` или явно подтвердить через Telegram approval
