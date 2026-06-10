---
name: force-hedge-preview
description: "NL impact preview перед force hedge: показывает что изменится, какие позиции затронуты"
readonly: true
tools:
  - get_plan
  - list_positions
---

# Skill: force-hedge-preview

## Когда использовать
- "force hedge plan #123", "preview hedge", "что будет если хеджировать"
- Оператор хочет понять impact перед destructive action

## Trigger Patterns
- "force hedge"
- "hedge preview"
- "impact preview"
- "что будет если"
- "preview hedge"

## Последовательность вызовов

1. `get_plan` — получить детали plan
   - Проверить текущий статус plan
   - Получить список legs и их статусы

2. `list_positions` — получить затронутые позиции
   - Найти позиции, связанные с plan instruments
   - Оценить notional exposure

3. Анализ impact:
   - Какие позиции будут затронуты
   - Ожидаемый P&L от hedge
   - Риски: slippage, timing, liquidity

## Формат ответа

```
🔮 Force Hedge Preview — Plan #{{plan_id}}

📋 Current State:
   Plan Status: {{plan_status}}
   Legs: {{legs_count}}
   Completed Legs: {{completed_count}}

💰 Impact Assessment:
   Positions Affected: {{positions_count}}
   Current Exposure: ${{exposure_usd}}
   Estimated Hedge Cost: ${{hedge_cost}}
   Expected P&L Impact: ${{pnl_impact}}

⚠️  Risks:
   {{risks_or_none}}

📝 Note: This is a preview only. No changes made.
   To execute: confirm force hedge with explicit approval.
```

## Guardrails
- Полностью read-only — только preview
- Никогда не инициирует hedge без подтверждения
- Всегда показывает risks и estimated costs