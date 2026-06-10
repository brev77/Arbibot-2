---
name: risk-summary
description: "Сводка risk decisions за период: количество, распределение по severity, тренды"
readonly: true
tools:
  - get_dashboard_summary
  - list_plans
---

# Skill: risk-summary

## Когда использовать
- "покажи risk summary", "risk report", "сводка рисков"
- Cron: ежедневный отчёт по рискам
- Оператор хочет понять текущий risk profile

## Trigger Patterns
- "risk summary"
- "сводка рисков"
- "risk report"
- "сколько рисков"
- "risk status"

## Последовательность вызовов

1. `get_dashboard_summary` — общая статистика
   - incidents count, positions count, notional USD

2. `list_plans` — список недавних plans
   - Фильтр: status in (planned, reserved, armed, executing, failed)
   - Группировка по статусу

3. Анализ:
   - Подсчитать plans по статусу
   - Выделить failed/unwound как risk signals
   - Определить тренд (если есть historical data)

## Формат ответа

```
📊 Risk Summary — {{date}}

🏢 System Status: {{safe_mode_status}}
📈 Active Plans: {{active_count}}
❌ Failed Plans (24h): {{failed_count}}
💰 Total Notional: ${{notional_usd}}

📋 Plans by Status:
   planned: {{count}}
   reserved: {{count}}
   armed: {{count}}
   executing: {{count}}
   completed: {{count}}
   failed: {{count}}

⚠️  Risk Signals:
   {{risk_signals_or_none}}
```

## Guardrails
- Полностью read-only
- Не выполняет никаких mutations