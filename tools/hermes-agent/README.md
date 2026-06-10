# Hermes Agent — Configuration

Конфигурация для подключения Hermes Agent (Python) к Arbibot 2 через MCP Server.

## Структура

| Файл | Назначение |
|------|-----------|
| `hermes-config.yaml` | Основной конфиг Agent (LLM, messaging, cron, security) |
| `mcp-config.json` | MCP Server connection config (stdio transport) |

## Быстрый старт

### 1. Установить Hermes Agent

```bash
# Linux/macOS
curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash

# Windows (PowerShell)
irm https://hermes-agent.nousresearch.com/install.ps1 | iex
```

### 2. Настроить переменные окружения

```bash
# Обязательные
export HERMES_LLM_API_KEY="your-llm-api-key"
export HERMES_API_KEY="your-hermes-gateway-api-key"

# Опциональные (Telegram)
export TELEGRAM_BOT_TOKEN="your-bot-token"
export OPERATOR_TELEGRAM_ID="your-telegram-id"

# Опциональные (Discord)
export DISCORD_BOT_TOKEN="your-discord-token"
export DISCORD_APP_ID="your-app-id"
```

### 3. Собрать MCP Server

```bash
# Из корня monorepo
npm run build -w @arbibot/hermes-mcp-server
```

### 4. Запустить Agent

```bash
cd tools/hermes-agent
hermes run --config hermes-config.yaml
```

### 5. Проверить

```bash
hermes doctor    # диагностика подключения
hermes tools     # список доступных MCP tools
```

## Архитектура

```
Operator → Telegram/Discord → Hermes Agent → MCP Server → Hermes Gateway → Domain Services
```

См. [`docs/adr-hermes-agent-integration.md`](../../docs/adr-hermes-agent-integration.md) для полного ADR.

## Переменные окружения

| Переменная | Обязательная | По умолчанию | Описание |
|-----------|-------------|-------------|----------|
| `HERMES_LLM_PROVIDER` | нет | `nousresearch` | LLM provider |
| `HERMES_LLM_MODEL` | нет | `hermes-3-llama-3.1-405b` | Model name |
| `HERMES_LLM_API_KEY` | **да** | — | API key для LLM |
| `HERMES_API_KEY` | **да** | — | Hermes Gateway API key |
| `HERMES_GATEWAY_URL` | нет | `http://localhost:3020` | Gateway URL |
| `HERMES_MCP_SERVER_PATH` | нет | `../../packages/hermes-mcp-server/dist/index.js` | MCP server path |
| `HERMES_TELEGRAM_ENABLED` | нет | `false` | Включить Telegram bot |
| `HERMES_DISCORD_ENABLED` | нет | `false` | Включить Discord bot |
| `HERMES_CRON_ENABLED` | нет | `false` | Включить cron jobs |
| `HERMES_LOG_LEVEL` | нет | `info` | Log level |

## MCP Tools (14)

| Tool | Метод | Описание |
|------|-------|----------|
| `list_plans` | GET | Список execution plans |
| `get_plan` | GET | Детали plan + legs |
| `arm_plan` | POST | Arm plan (requires approval) |
| `execute_plan` | POST | Execute plan (requires approval) |
| `list_positions` | GET | Список позиций портфеля |
| `close_position` | POST | Закрыть позицию (requires approval) |
| `list_incidents` | GET | Список инцидентов |
| `resolve_incident` | POST | Решить инцидент (requires approval) |
| `list_incident_briefs` | GET | Краткие сводки инцидентов |
| `get_safe_mode_status` | GET | Статус safe mode |
| `enable_safe_mode` | POST | Включить safe mode (requires approval) |
| `disable_safe_mode` | POST | Выключить safe mode (requires approval) |
| `get_approvals_queue` | GET | Очередь approvals |
| `get_dashboard_summary` | GET | Сводка дашборда |

## Безопасность

- Mutation tools требуют explicit approval оператора
- Все действия логируются через audit-service
- API keys хранятся в env, не в конфигах
- Telegram/Discord — whitelist операторов