# Hermes Agent — Configuration

Конфигурация для подключения внешнего **Hermes Agent** (NousResearch) к Arbibot 2 через MCP Server.

**Текущая конфигурация (Plan 5):** LLM = **GLM 5.2** (через Zhipu/Z.AI, OpenAI-совместимый `base_url`); messaging = **личный Telegram-бот** оператора. См. [`docs/adr-hermes-agent-glm-telegram.md`](../../docs/adr-hermes-agent-glm-telegram.md).

## Структура

| Файл | Назначение |
|------|-----------|
| `hermes-config.yaml` | Основной конфиг Agent (LLM, messaging, cron, security) |
| `mcp-config.json` | MCP Server connection config (stdio transport) |
| `skills/*.md` | Arbibot-навыки агента (7 шт., включая `explain-bot`) |

## Быстрый старт

### 1. Установить Hermes Agent (внешний бинарник)

```bash
# Linux/macOS
curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash

# Windows (PowerShell)
irm https://hermes-agent.nousresearch.com/install.ps1 | iex
```

### 2. Получить ключ GLM 5.2

Зарегистрируйтесь на [https://open.bigmodel.cn](https://open.bigmodel.cn) и создайте API-ключ. Модель — `glm-5.2`. API совместим с OpenAI Chat Completions, base_url: `https://open.bigmodel.cn/api/paas/v4`.

### 3. Создать Telegram-бота

1. В Telegram откройте [@BotFather](https://t.me/BotFather) → `/newbot` → получите **токен**.
2. Узнайте свой **Telegram ID** у [@userinfobot](https://t.me/userinfobot) (это whitelist — бот будет отвечать только вам).

### 4. Заполнить переменные окружения

Скопируйте `.env.example` в `.env` (из корня монорепо) и заполните секцию `hermes-agent`:

```bash
# GLM 5.2 (OpenAI-совместимый провайдер)
HERMES_LLM_PROVIDER=openai
HERMES_LLM_MODEL=glm-5.2
HERMES_LLM_BASE_URL=https://open.bigmodel.cn/api/paas/v4
HERMES_LLM_API_KEY=<ваш ключ из open.bigmodel.cn>

# Telegram (личный бот)
HERMES_TELEGRAM_ENABLED=true
TELEGRAM_BOT_TOKEN=<токен от @BotFather>
OPERATOR_TELEGRAM_ID=<ваш ID от @userinfobot>

# MCP Server → Hermes Gateway
HERMES_GATEWAY_URL=http://127.0.0.1:3020
HERMES_API_KEY=<ключ из HERMES_API_KEYS на gateway>
```

### 5. Поднять Hermes Gateway и собрать MCP-сервер

```bash
# Из корня монорепо
npm run dev:hermes            # gateway на :3020 (в отдельном терминале)
npm run build:hermes-mcp      # собрать MCP-сервер
```

### 6. Проверить готовность и запустить агента

```bash
npm run doctor:hermes         # чек-лист: MCP собран ✓, env заданы ✓, gateway отвечает ✓
npm run run:hermes            # запуск: hermes gateway run (messaging gateway: Telegram polling + cron)
```

После старта напишите боту в Telegram `/status` или спросите «объясни работу бота».

> ⚠️ **Команда запуска:** `hermes gateway run`, а НЕ `hermes run`. Upstream hermes-agent
> (NousResearch, версии 0.13–0.19) **не имеет** подкоманды `run` — messaging gateway
> запускается через `gateway run`. Конфиг `hermes-config.yaml` читается агентом из
> `~/.hermes/config.yaml` и `~/.hermes/.env`, поэтому секреты должны быть прописаны и там
> (см. `tools/doctor-hermes-agent.mjs` — read-only проверка готовности).

## Архитектура

```
Operator → Telegram → Hermes Agent (Python, GLM 5.2) → MCP Server (TS) → Hermes Gateway (NestJS) → Domain Services
```

См. ADR-ы: [`adr-hermes-agent-glm-telegram.md`](../../docs/adr-hermes-agent-glm-telegram.md) (Plan 5), [`adr-hermes-agent-integration.md`](../../docs/adr-hermes-agent-integration.md) (Plan 3), [`adr-hermes-mcp-server.md`](../../docs/adr-hermes-mcp-server.md) (MCP-архитектура).

## Переменные окружения

| Переменная | Обязательная | По умолчанию | Описание |
|-----------|-------------|-------------|----------|
| `HERMES_LLM_PROVIDER` | нет | `openai` | LLM provider (GLM подключается как `openai` + `base_url`) |
| `HERMES_LLM_MODEL` | нет | `glm-5.2` | Модель |
| `HERMES_LLM_BASE_URL` | нет | `https://open.bigmodel.cn/api/paas/v4` | base_url API Zhipu/Z.AI |
| `HERMES_LLM_API_KEY` | **да** | — | Ключ из https://open.bigmodel.cn |
| `HERMES_API_KEY` | **да** | — | Ключ для Hermes Gateway (из `HERMES_API_KEYS`) |
| `HERMES_GATEWAY_URL` | нет | `http://localhost:3020` | URL gateway |
| `HERMES_MCP_SERVER_PATH` | нет | `../../packages/hermes-mcp-server/dist/index.js` | Путь к собранному MCP-серверу |
| `HERMES_TELEGRAM_ENABLED` | нет | `true` | Включить Telegram-бота |
| `TELEGRAM_BOT_TOKEN` | **да** (если Telegram on) | — | Токен от @BotFather |
| `OPERATOR_TELEGRAM_ID` | **да** (если Telegram on) | — | Ваш Telegram ID (whitelist) |
| `HERMES_OPERATOR_ID` | нет | `OPERATOR_TELEGRAM_ID` | operatorId для config-mutations (Plan 6) |
| `HERMES_DISCORD_ENABLED` | нет | `false` | Включить Discord-бота |
| `HERMES_CRON_ENABLED` | нет | `true` | Периодические сводки в Telegram («следит за ботом») |
| `HERMES_LOG_LEVEL` | нет | `info` | Log level |

## Команды Telegram

| Команда | Навык | Назначение |
|---------|-------|-----------|
| `/status` | status_check | Обзор состояния системы |
| `/plans` | plan_review | Анализ execution plans |
| `/positions` | position_overview | Обзор портфеля |
| `/incidents` | incident_management | Управление инцидентами |
| `/safe` | safe_mode_control | Управление safe mode |
| `/approve` | approval_handler | Очередь approvals |
| `/explain` | explain_bot | Объяснение работы бота (Plan 5) |
| `/config` | config_management | Управление настройками бота (Plan 6, только безопасные ключи) |

## MCP Tools (22)

### Operational (14)

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

### Config management (Plan 6, +8)

Только безопасные ключи: `intake.*`, `paper.*`, `opportunity.*`, `dex.*`, `features.*`. Sensitive (`risk.*`/`execution.*`/`capital.*`) — только через UI `/settings`. Все mutations требуют подтверждения оператора в Telegram. См. [`docs/adr-hermes-config-management.md`](../../docs/adr-hermes-config-management.md).

| Tool | Метод | Описание |
|------|-------|----------|
| `list_configs` | GET | Список ключей конфигурации |
| `get_config` | GET | Текущее значение ключа |
| `get_effective_config` | GET | Resolved-значение со scope-fallback |
| `get_config_history` | GET | История версий ключа |
| `update_config` | PUT | Изменить значение (requires approval) |
| `rollback_config` | POST | Откатить к прошлой версии (requires approval) |
| `promote_config` | POST | Промоут между scope (requires approval) |
| `activate_config` | PATCH | Активировать draft (requires approval) |

## Устранение неполадок

- **`base_url` не поддерживается вашей сборкой агента.** Поднимите локальный OpenAI-совместимый прокси (например, `litellm`), который слушает `http://localhost:8000/v1` и пробрасывает в `https://open.bigmodel.cn/api/paas/v4`. В `.env` поставьте `HERMES_LLM_BASE_URL=http://localhost:8000/v1`. См. fallback в [ADR](../../docs/adr-hermes-agent-glm-telegram.md#5-fallback).
- **Gateway не отвечает / `npm run doctor:hermes` падает на шаге 4.** Запустите gateway: `npm run dev:hermes` и проверьте `HERMES_GATEWAY_URL`.
- **Ключ HERMES_API_KEY отклонён (401/403).** Значение `HERMES_API_KEY` у агента должно совпадать с одним из значений `HERMES_API_KEYS` на gateway.
- **Telegram-бот молчит.** Проверьте `TELEGRAM_BOT_TOKEN` и что `OPERATOR_TELEGRAM_ID` — именно ваш ID (число, у @userinfobot). Бот отвечает **только** пользователям из whitelist.
- **Ошибки модели GLM (401/invalid api key).** Проверьте `HERMES_LLM_API_KEY` и что `HERMES_LLM_BASE_URL` указывает на `…/v4`.
- **MCP-сервер не найден.** Запустите `npm run build:hermes-mcp`, проверьте файл `packages/hermes-mcp-server/dist/index.js`.

## Запуск через Docker

Профиль `hermes-agent` в `infra/docker-compose.dev.yml`:

```bash
npm run dev:stack:hermes-agent
# или явно:
docker compose -f infra/docker-compose.dev.yml --profile hermes-agent up -d
```

> Публичного официального образа NousResearch Hermes Agent нет, поэтому compose-сервис оставлен шаблоном с `# TODO` — подставьте образ вашей сборки агента.

## Безопасность

- Mutation tools требуют explicit approval оператора (наследуется от gateway/MCP).
- Все actions логируются через audit-service с `sourceModule: hermes-agent`.
- API keys хранятся в env, не в конфигах (никогда не коммитьте `.env` и `hermes-config.local.yaml`).
- Telegram — whitelist операторов (только `OPERATOR_TELEGRAM_ID`).
- HERMES — не источник истины: объясняет read-модели, но не принимает решений о капитале/риске/arm/execute (см. [`docs/hermes-operator-boundaries.md`](../../docs/hermes-operator-boundaries.md)).