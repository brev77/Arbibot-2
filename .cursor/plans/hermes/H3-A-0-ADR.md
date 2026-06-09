# H3-A-0-ADR — ADR: обоснование переименования + маппинг

| Поле | Значение |
|------|----------|
| **depends_on** | — |
| **risk_level** | `low` |
| **estimated_hours** | 0.5 |
| **status** | planned |

## Outputs
- `docs/adr-hermes-rename.md`

## Содержание ADR
1. Контекст: почему OpenClaw → Hermes (путаница с Go-based проектом, подготовка к Agent)
2. Маппинг имён (см. индекс: PascalCase, camelCase, UPPER, kebab-case, header, path, npm)
3. Риски: breaking change для deployed env vars, git history
4. Решение: поэтапное переименование с верификацией
5. Hermes Agent integration: MCP server как мост

## Test Commands
—
## Rollback
Удалить ADR файл