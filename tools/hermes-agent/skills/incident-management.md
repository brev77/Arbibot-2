---
name: incident_management
description: "Управление инцидентами и reconciliation mismatches: сводка, triage, рекомендации. Для /incidents и cron reconciliation_report"
readonly: false
tools:
  - list_incidents
  - list_incident_briefs
  - resolve_incident
approval_required:
  - resolve_incident
---

# Skill: incident-management

> **Управление инцидентами + reconciliation.** Cron `reconciliation_report`
> (каждые 6 часов: "Summarize open incidents and reconciliation mismatches") и
> команда `/incidents`. Этот skill объединяет домен инцидентов (открытые/резолвленные)
> и reconciliation mismatches — обе поверхности связаны (многие инциденты порождаются
> unreconciled mismatches).
>
> **Отличие от соседних skills:**
> - `investigate-incident` — детальный разбор **конкретного** инцидента (root cause).
> - `reconciliation-check` — только reconciliation mismatches (без incident triage).
> - `investigate-alert` — Prometheus/Alertmanager алерты (другая таблица).
> - Этот skill (`incident_management`) — **сводка + triage** всех инцидентов + mismatches
>   для cron-отчёта и команды `/incidents`.

## Когда использовать

- Cron `reconciliation_report` (каждые 6 часов) — суммарная сводка
- Команда `/incidents` в Telegram — оператор хочет обзор инцидентов
- Оператор спрашивает: "инциденты?", "что случилось?", "reconciliation?", "mismatches?"
- Оператор хочет закрыть инцидент (через approval)

## Trigger Patterns

- "incidents", "инциденты", "что случилось"
- "reconciliation", "мismatch", "расхождения"
- "open issues", "проблемы"
- "resolve incident {{id}}", "закрыть инцидент"

## Последовательность вызовов

### Для сводки (cron / `/incidents`):

1. `list_incidents` — получить инциденты
   - Фильтр `status=open` → активные
   - Сортировка по severity (critical → high → medium → low)

2. `list_incident_briefs` — получить краткие сводки
   - Быстрый overview без деталей
   - Группировка по source (execution, reconciliation, capital, dex)

3. Анализ:
   - Подсчитать по severity (critical/high/medium/low)
   - Подсветить critical без assignee
   - Подсветить старые open (> 1 часа без прогресса)
   - Связать с reconciliation mismatches если есть

4. Формат отчёта

### Для resolve (с approval):

1. `list_incidents` → найти нужный
2. Подтвердить с оператором (показать что будет resolved)
3. `resolve_incident` (требует approval — в `approval_required`)

## Формат ответа (Telegram, кратко)

### Cron `reconciliation_report`:

```
📋 Incident & reconciliation report ({{timestamp}})

{{open_count}} open incident(s), {{mismatch_count}} unreconciled mismatch(es)

{{#if critical_count}}
🔴 Critical ({{critical_count}}):
{{#each critical}}  - {{title}} — {{age}} old
{{/each}}
{{/if}}

{{#if high_count}}
🟠 High ({{high_count}}):
{{#each high}}  - {{title}}
{{/each}}
{{/if}}

{{#if mismatches}}
⚠️ Unreconciled mismatches ({{mismatch_count}}):
{{#each mismatches}}  - {{route}}: {{amount}} {{instrument}} ({{age}})
{{/each}}
{{else}}
✅ All reconciled
{{/if}}

{{#if open_count > 0}}
Investigate: /incidents {{top_id}} for details
{{/if}}
```

Если всё чисто (0 incidents + 0 mismatches):
```
✅ All clear — 0 open incidents, 0 unreconciled mismatches
```

### Команда `/incidents`:

```
📋 Incidents ({{open_count}} open, {{resolved_today}} resolved today)

{{#each open}}
{{severity_emoji}} {{id}} — {{title}}
   {{severity}} | {{source}} | {{age}}
   {{brief}}
{{/each}}

To investigate: ask me about specific incident
To resolve: confirm via approval flow
```

Legend: 🔴 critical | 🟠 high | 🟡 medium | 🔵 low

## Guardrails

- **Resolve требует approval** (`resolve_incident` в `approval_required`)
- Read-only для сводок (list_incidents, list_incident_briefs)
- НЕ создавать инциденты искусственно — только читать и triage существующие
- Для детального root-cause анализа конкретного инцидента → `investigate-incident`
- Для reconciliation-specific проверки (без incident triage) → `reconciliation-check`
- Для Prometheus-алертов → `investigate-alert` (разная source-таблица)
- Severity не понижается автоматически — только оператором
