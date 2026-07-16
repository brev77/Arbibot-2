# ADR: Hermes Agent — GLM 5.2 + Telegram

**Status:** Accepted
**Date:** 2026-07-16
**Context:** Plan 5 (H5-A-0)
**Supersedes:** нет (расширяет [`docs/adr-hermes-agent-integration.md`](adr-hermes-agent-integration.md))
**Не затрагивает:** [`docs/adr-hermes-mcp-server.md`](adr-hermes-mcp-server.md) — gateway остаётся чистым HTTP-прокси

## 1. Контекст

Plan 3 (H3-C) подключил внешний **Hermes Agent** (NousResearch) к проекту через MCP Server и Hermes Gateway. В конфиге по умолчанию стоял `provider: nousresearch`, `model: hermes-3-llama-3.1-405b`, Telegram `enabled: false`.

По решению владельца продукта агент должен:

1. Использовать **GLM 5.2** (Zhipu/Z.AI) как LLM вместо модели NousResearch.
2. Быть подключённым к **Telegram** как личный бот оператора (whitelist `OPERATOR_TELEGRAM_ID`).
3. Помогать разбираться в работе Arbibot-бота — объяснять архитектуру и текущее состояние, «следить за ботом» (периодические heartbeat-отчёты через cron).

Сам Hermes Agent — **внешний** продукт, Python-кода агента в монорепозитории нет (см. ADR Plan 3 §4). Монорепо хранит только «проводку»: `tools/hermes-agent/hermes-config.yaml`, `mcp-config.json` и скиллы `.md`. MCP Server (`packages/hermes-mcp-server`) и Hermes Gateway (`apps/hermes-gateway`) **уже реализованы** и остаются без изменений.

## 2. Decision

### LLM = GLM 5.2 (через OpenAI-совместимый `base_url`)

API GLM от Zhipu/Z.AI совместим с OpenAI Chat Completions. У NousResearch Hermes Agent нет нативного плагина под «glm», но есть провайдер `openai`. Поэтому подключаем так:

```yaml
agent:
  provider: openai                       # HERMES_LLM_PROVIDER=openai
  model: glm-5.2                         # HERMES_LLM_MODEL=glm-5.2
  base_url: https://open.bigmodel.cn/api/paas/v4   # HERMES_LLM_BASE_URL
  api_key: ${HERMES_LLM_API_KEY}         # ключ из https://open.bigmodel.cn
```

Поле `base_url` добавлено в конфиг (раньше его не было). Значения берутся из env, чтобы не зашивать жёстко.

### Messaging = личный Telegram-бот

```yaml
messaging:
  telegram:
    enabled: true
    token: ${TELEGRAM_BOT_TOKEN}          # токен от @BotFather
    allowed_users: [${OPERATOR_TELEGRAM_ID}]   # whitelist; бот отвечает только оператору
```

Discord остаётся выключенным (`HERMES_DISCORD_ENABLED=false`).

### Мониторинг бота = cron

`cron.enabled: true` включает периодические задачи агента (heartbeat, reconciliation, daily risk summary, approval queue check), которые шлют сводки в Telegram — это и есть «следит за ботом».

## 3. Поток запроса

```
Operator → Telegram → Hermes Agent (Python, GLM 5.2)
                          ↓ MCP (stdio)
                    packages/hermes-mcp-server (TS, готов)
                          ↓ HTTP (x-hermes-api-key)
                    apps/hermes-gateway (NestJS, порт 3020 — чистый прокси)
                          ↓ HTTP
                    Domain services (execution, portfolio, risk, audit)
```

MCP Server и Gateway **не меняются** — это по-прежнему тонкий мост с auth, rate-limit и audit.

## 4. Почему GLM через openai-compat

| Вариант | Плюс | Минус | Вердикт |
|---------|------|-------|---------|
| GLM как `provider: openai` + кастомный `base_url` | работает с OpenAI-совместимым API Zhipu без кода | требует поддержки `base_url` в сборке агента | **Принято** |
| Локальный self-hosted GLM (vLLM/Ollama) | не нужен внешний ключ | нужна инфраструктура GPU | Отклонено (нет железа) |
| Сторонний шлюз (OpenRouter и т.п.) | единый API | лишнее звено + платный шлюз | Отклонено |

## 5. Fallback

Если конкретная сборка внешнего Hermes Agent **не поддерживает** поле `base_url`:

1. Поднять локальный OpenAI-совместимый прокси (например, `litellm` или простой реверс-прокси), который слушает `http://localhost:8000/v1` и пробрасывает в `https://open.bigmodel.cn/api/paas/v4`.
2. В конфиге указать `base_url: http://localhost:8000/v1`.
3. Всё остальное (provider=openai, model=glm-5.2, api_key) без изменений.

В любом случае **единственный источник истины — env-переменные** (`HERMES_LLM_PROVIDER` / `HERMES_LLM_BASE_URL` / `HERMES_LLM_MODEL`); в YAML нет жёстко зашитых значений.

## 6. Безопасность

- Ключ GLM (`HERMES_LLM_API_KEY`) и токен Telegram (`TELEGRAM_BOT_TOKEN`) хранятся **только в env**, никогда в git/конфигах.
- Telegram-бот работает по **whitelist**: отвечает только `OPERATOR_TELEGRAM_ID`.
- Mutation-tools (`arm_plan`, `execute_plan`, `enable_safe_mode`, `disable_safe_mode`, `resolve_incident`, `close_position`) по-прежнему требуют **explicit approval** оператора — наследуется от gateway/MCP, без изменений.
- Все mutations логируются через audit-service с `sourceModule: hermes-agent` (см. ADR Plan 3 §3).
- Архитектурные границы из [`docs/HERMES-operator-boundaries.md`](HERMES-operator-boundaries.md): агент объясняет read-модели и подсказывает runbook, но **не** принимает решений о капитале/риске/arm/execute и **не** пишет напрямую в доменные таблицы.

## 7. Что НЕ меняется

- `apps/hermes-gateway` — остаётся чистым HTTP-прокси (см. `adr-hermes-mcp-server.md` §93-96).
- `packages/hermes-mcp-server` — уже реализован, только собирается (`npm run build:hermes-mcp`).
- Архитектура Agent → MCP → Gateway — без изменений.

## 8. Компоненты плана

| Что | Где |
|------|-----|
| ADR (этот файл) | `docs/adr-hermes-agent-glm-telegram.md` |
| Конфиг агента | `tools/hermes-agent/hermes-config.yaml` (provider→openai, +base_url, Telegram on) |
| MCP конфиг | `tools/hermes-agent/mcp-config.json` |
| Env-документация | `.env.example` (новая секция hermes-agent) |
| Скилл «объясни работу бота» | `tools/hermes-agent/skills/explain-bot.md` |
| npm-скрипты запуска/проверки | корневой `package.json` + `tools/run-hermes-agent.mjs`, `tools/doctor-hermes-agent.mjs` |
| Docker-профиль | `infra/docker-compose.dev.yml` (`--profile hermes-agent`) |
| План | `.cursor/plans/DEVELOPMENT_PLAN5.md` |

## 9. Rollback

Вернуть прежние дефолты:

- `tools/hermes-agent/hermes-config.yaml`: `provider: ${HERMES_LLM_PROVIDER:nousresearch}`, `model: ${HERMES_LLM_MODEL:hermes-3-llama-3.1-405b}`, убрать `base_url`, `messaging.telegram.enabled: ${HERMES_TELEGRAM_ENABLED:false}`.
- Удалить созданные npm-скрипты и `.mjs`-хелперы (опционально).
- Этот ADR оставить как историческую справку (Status → Superseded/Reverted).
