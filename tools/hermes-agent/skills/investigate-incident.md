---
name: investigate-incident
description: "Автоматический анализ инцидента: собирает данные, определяет причину, рекомендует действие"
readonly: false
tools:
  - list_incidents
  - get_plan
  - resolve_incident
approval_required:
  - resolve_incident
---

# Skill: investigate-incident

## Когда использовать
- Оператор спрашивает об инциденте: "что случилось?", "investigate incident #123"
- Alert о новом инциденте от cron/monitoring
- Оператор хочет узнать статус и рекомендации

## Trigger Patterns
- "investigate incident"
- "что за инцидент"
- "analyze incident"
- "check alert"
- "инцидент"

## Последовательность вызовов

1. `list_incidents` — получить список открытых инцидентов
   - Фильтр: status=open, sort by severity desc
   - Если указан ID — сразу к шагу 2

2. `get_plan` — получить детали связанного execution plan
   - Определить plan_id из incident context
   - Проверить статус legs иfills

3. Анализ:
   - Сопоставить incident type с known patterns
   - Оценить severity и impact
   - Сформулировать рекомендацию

4. Если рекомендация — resolve:
   - Запросить подтверждение оператора
   - Вызвать `resolve_incident` с reason

## Формат ответа

```
🔍 Incident #{{id}} — {{type}}
   Severity: {{severity}}
   Status: {{status}}
   Plan: #{{plan_id}} ({{plan_status}})
   
📊 Analysis:
   {{root_cause_analysis}}
   
✅ Recommendation:
   {{recommendation}}
   
⚠️  Requires approval: resolve_incident
   Reason: {{resolution_reason}}
```

## Guardrails
- Автоанализ — read-only, выполняется без подтверждения
- `resolve_incident` — ТОЛЬКО с подтверждением оператора
- Никогда не auto-resolve critical инциденты