# H3-C-0-ADR-AGENT — ADR: Hermes Agent integration pattern

| Поле | Значение |
|------|----------|
| **depends_on** | `H3-B-3-TESTS` |
| **risk_level** | `low` |
| **estimated_hours** | 1 |
| **status** | planned |

## Outputs
- `docs/adr-hermes-agent-integration.md`

## Содержание ADR
1. Контекст: Hermes Agent как AI-assisted operator interface
2. Архитектура: Agent → MCP Server → Hermes Gateway → Domain Services
3. Security: API key, command approval, audit trail
4. Deployment: внешний процесс, не в monorepo
5. Messaging: Telegram/Discord bot для alerts и actions
6. Skills: Arbibot-специфичные навыки
7. Cron: периодические задачи (reconciliation reports, risk summaries)
8. Memory: сохранение контекста оператора

## Rollback
Удалить ADR файл