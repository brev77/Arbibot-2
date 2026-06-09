# H3-C-1-CONFIG — Agent configuration

| Поле | Значение |
|------|----------|
| **depends_on** | `H3-C-0-ADR-AGENT` |
| **risk_level** | `medium` |
| **estimated_hours** | 2 |
| **status** | planned |

## Outputs
- `tools/hermes-agent/hermes-config.yaml` — agent config
- `tools/hermes-agent/mcp-config.json` — MCP server connection

## Конфигурация
1. Установка: `curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash`
2. LLM provider: Nous Portal / OpenRouter / custom
3. MCP server: `hermes tools add-hermes-mcp`
4. Messaging: Telegram/Discord bot tokens
5. Security: command approval patterns для mutations

## Edge Cases
- Hermes Agent — Python, устанавливается отдельно
- API keys в secrets, не в конфигах
- Windows: PowerShell installer

## Test Commands
```bash
hermes doctor
hermes tools
```

## Rollback
Удалить `tools/hermes-agent/`