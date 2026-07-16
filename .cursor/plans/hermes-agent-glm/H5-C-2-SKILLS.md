# H5-C-2-SKILLS — Скилл `explain-bot.md`

| Поле | Значение |
|------|----------|
| **depends_on** | `H5-B-1-CONFIG` |
| **risk_level** | `low` |
| **status** | done |

## Outputs
- `tools/hermes-agent/skills/explain-bot.md` — новый read-only скилл.

## Содержание
Объясняет работу Arbibot-бота по-русски: архитектуру (paper/live, single-writer, reservation-first, outbox/inbox, ExecutionPlan, safe mode, reconciliation, HERMES), текущее состояние (через `get_dashboard_summary`), значения показателей. Tools: `get_dashboard_summary`, `list_plans`, `list_positions`, `list_incidents`. Trigger patterns на русском и английском. Guardrails: полностью read-only, направляет на другие скиллы при запросе действия.

## Edge Cases
- Не придумывает числа — берёт реальные данные из read-only tools.
- Формат соответствует существующим скиллам (frontmatter + секции).

## Test
```bash
test -f tools/hermes-agent/skills/explain-bot.md && echo OK
```
