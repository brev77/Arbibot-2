# H3-C-2-SKILLS — Arbibot-specific skills (6 skills)

| Поле | Значение |
|------|----------|
| **depends_on** | `H3-C-1-CONFIG` |
| **risk_level** | `low` |
| **estimated_hours** | 4 |
| **status** | planned |

## Outputs
- `tools/hermes-agent/skills/` — Arbibot-специфичные навыки

## Skills
| Skill | Описание | MCP Tools |
|-------|----------|-----------|
| `investigate-incident` | Автоанализ инцидента → рекомендация | `list_incidents`, `get_plan`, `resolve_incident` |
| `risk-summary` | Сводка risk decisions за период | `get_dashboard_summary`, `list_plans` |
| `reconciliation-check` | Mismatches → отчёт → рекомендации | `list_incidents`, `list_incident_briefs` |
| `force-hedge-preview` | NL impact preview перед force hedge | `get_plan`, `list_positions` |
| `daily-report` | Ежедневный отчёт (cron) | `get_dashboard_summary`, `list_positions`, `list_plans` |
| `safe-mode-check` | Проверка + рекомендация safe-mode | `get_safe_mode_status`, `enable_safe_mode`, `disable_safe_mode` |

## Каждый навык
- Description: когда и зачем
- Trigger patterns: natural language триггеры
- Tool calls: последовательность MCP вызовов
- Output format: формат ответа

## Edge Cases
- Навыки — markdown/yaml, не TypeScript
- Не обходят approval flow
- Mutation навыки требуют подтверждение

## Test Commands
```bash
hermes skills
hermes "/investigate-incident"
```

## Rollback
Удалить `tools/hermes-agent/skills/`