# H5-B-2-ENV — Секция hermes-agent в `.env.example`

| Поле | Значение |
|------|----------|
| **depends_on** | `H5-B-1-CONFIG` |
| **risk_level** | `low` (документация env) |
| **status** | done |

## Outputs
- `.env.example` — новая секция `hermes-agent` после блока hermes-gateway.

## Переменные
`HERMES_LLM_PROVIDER`, `HERMES_LLM_MODEL`, `HERMES_LLM_BASE_URL`, `HERMES_LLM_API_KEY`, `HERMES_TELEGRAM_ENABLED`, `TELEGRAM_BOT_TOKEN`, `OPERATOR_TELEGRAM_ID`, `HERMES_GATEWAY_URL`, `HERMES_API_KEY`, `HERMES_MCP_SERVER_PATH`, `HERMES_CRON_ENABLED`, `HERMES_MEMORY_PATH`, `HERMES_LOG_LEVEL`.

## Edge Cases
- Все строки закомментированы (пример, не активные значения).
- Секреты (`HERMES_LLM_API_KEY`, `TELEGRAM_BOT_TOKEN`) — только плейсхолдеры, никогда реальные значения.

## Test
```bash
grep -c "HERMES_LLM_API_KEY" .env.example   # >= 1
grep -c "TELEGRAM_BOT_TOKEN" .env.example    # >= 1
```
