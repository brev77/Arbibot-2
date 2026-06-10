---
name: reconciliation-check
description: "Проверка reconciliation mismatches: отчёт о расхождениях и рекомендации"
readonly: true
tools:
  - list_incidents
  - list_incident_briefs
---

# Skill: reconciliation-check

## Когда использовать
- "reconciliation report", "проверь reconciliation", "mismatches"
- Cron: каждые 6 часов
- Оператор хочет проверить consistency системы

## Trigger Patterns
- "reconciliation"
- "mismatches"
- "recon check"
- "расхождения"
- "consistency check"

## Последовательность вызовов

1. `list_incidents` — получить reconciliation-инциденты
   - Фильтр: type=reconciliation, status=open

2. `list_incident_briefs` — краткие сводки
   - Группировка по severity и entity type

3. Анализ:
   - Подсчитать mismatches по типу
   - Определить критические расхождения
   - Рекомендовать действия

## Формат ответа

```
🔄 Reconciliation Check — {{date}}

📊 Mismatch Summary:
   Total open: {{total}}
   Critical: {{critical_count}}
   Warning: {{warning_count}}
   Info: {{info_count}}

📋 By Entity Type:
   ExecutionPlan: {{count}}
   PortfolioPosition: {{count}}
   ExecutionLeg: {{count}}

⚠️  Critical Mismatches:
   {{critical_details_or_none}}

✅ Recommendation:
   {{recommendation}}
```

## Guardrails
- Полностью read-only
- Не резолвит инциденты автоматически