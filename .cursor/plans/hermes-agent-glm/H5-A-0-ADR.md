# H5-A-0-ADR — ADR: Hermes Agent GLM 5.2 + Telegram

| Поле | Значение |
|------|----------|
| **depends_on** | — (первый шаг) |
| **risk_level** | `low` (документация) |
| **status** | done |

## Outputs
- `docs/adr-hermes-agent-glm-telegram.md` — ADR (Status: Accepted).

## Содержание
ADR фиксирует: LLM = GLM 5.2 (Zhipu/Z.AI) через OpenAI-совместимый `base_url`; messaging = личный Telegram-бот (whitelist); MCP Server и Gateway без изменений; fallback через локальный OpenAI-compat прокси если сборка агента не поддерживает `base_url`; безопасность (ключи только в env, mutations требуют approval). Расширяет `adr-hermes-agent-integration.md`, НЕ затрагивает `adr-hermes-mcp-server.md`.

## Test
- Файл существует и содержит секции Decision / Fallback / Security / Rollback.

## Review notes
- Согласовано с владельцем продукта: LLM = GLM 5.2 (Zhipu/Z.AI), Telegram = личный бот.
