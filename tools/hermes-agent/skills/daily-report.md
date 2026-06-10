---
name: daily-report
description: "Ежедневный отчёт: дашборд, позиции, plans, инциденты за сутки"
readonly: true
tools:
  - get_dashboard_summary
  - list_positions
  - list_plans
---

# Skill: daily-report

## Когда использовать
- "daily report", "ежедневный отчёт", "итоги дня"
- Cron: каждый день в 09:00 UTC
- Оператор запрашивает сводку

## Trigger Patterns
- "daily report"
- "ежедневный отчёт"
- "итоги дня"
- "daily summary"
- "report for today"

## Последовательность вызовов

1. `get_dashboard_summary` — общая статистика
2. `list_positions` — текущие открытые позиции
3. `list_plans` — plans за последние 24 часа

## Формат ответа

```
📅 Daily Report — {{date}}

🏢 System: {{safe_mode_status}}
📊 Dashboard:
   Open Incidents: {{incidents_open}}
   Active Positions: {{positions_count}}
   Total Notional: ${{notional_usd}}

📈 Plans (24h):
   Created: {{created_count}}
   Completed: {{completed_count}}
   Failed: {{failed_count}}

💼 Top Positions:
   {{top_positions_list}}

⚠️  Alerts:
   {{alerts_or_none}}
```

## Guardrails
- Полностью read-only
- Не выполняет никаких mutations