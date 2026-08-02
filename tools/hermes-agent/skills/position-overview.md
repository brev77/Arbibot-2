---
name: position_overview
description: "Обзор портфеля: открытые позиции, notional, P/L. Для команды /positions и daily risk summary"
readonly: true
tools:
  - list_positions
  - get_dashboard_summary
---

# Skill: position-overview

> **Обзор портфеля.** Команда `/positions` в Telegram и cron `daily_risk_summary`.
> Показывает открытые позиции и их метрики; close position — отдельный approval flow.

## Когда использовать

- Команда `/positions` в Telegram
- Cron `daily_risk_summary` (каждый день 9AM) — итоговая сводка портфеля
- Оператор спрашивает: "позиции?", "портфель?", "что открыто?", "мой exposure"

## Trigger Patterns

- "positions", "позиции", "портфель"
- "exposure", "открытые позиции"
- "what's my portfolio", "мой портфель"
- "P/L", "прибыль/убыток"

## Последовательность вызовов

1. `list_positions` — получить открытые позиции
   - Без фильтра → все открытые
   - Фильтр по instrument, side, chainId (если оператор уточнил)

2. `get_dashboard_summary` — агрегированные метрики
   - Total notional USD
   - Capital positions count

3. Анализ:
   - Подсветить крупные позиции (> 20% total notional — concentration risk)
   - Подсветить позиции с большим unrealized loss
   - Подсветить stale позиции (давно без обновления)
   - Группировка по chain / instrument

## Формат ответа (Telegram, кратко)

### Список позиций:

```
📊 Portfolio overview

Total notional: ${{total_notional}}
Open positions: {{count}}

{{#each positions}}
{{side_emoji}} {{instrument}} — {{qty}} @ ${{entry_price}}
   Chain: {{chainId}} | Notional: ${{notional}} | P/L: {{pnl_emoji}} ${{pnl}}
{{/each}}

Legend: 🟢 long | 🔴 short | P/L: 🟢 profit / 🔴 loss
```

### Daily risk summary (cron):

```
📊 Daily portfolio summary ({{date}})

Total exposure: ${{total_notional}} across {{count}} positions
Top concentration: {{top_instrument}} ({{pct}}%)
Chains: {{chains_summary}}

{{#if concerns}}
⚠️ Concerns:
{{#each concerns}}  - {{this}}
{{/each}}
{{/if}}
```

## Guardrails

- **Read-only**: этот skill НЕ закрывает позиции
- Для close position → operator confirms через approval flow
- P/L — это unrealized, не realized (до закрытия)
- Для детального risk analysis → `risk-summary`
