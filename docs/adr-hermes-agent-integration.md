# ADR: Hermes Agent Integration Pattern

**Status:** Accepted  
**Date:** 2026-06-11  
**Context:** Plan 3 (H3-C-0-ADR-AGENT)

## 1. Контекст

Hermes Agent — AI-assisted интерфейс оператора для Arbibot 2. Агент взаимодействует с системой через MCP (Model Context Protocol) server, который подключается к Hermes Gateway. Это позволяет оператору управлять арбитражной системой через естественный язык (Telegram/Discord).

## 2. Архитектура

```
Operator → Telegram/Discord → Hermes Agent (Python) → MCP Server (TS) → Hermes Gateway (NestJS) → Domain Services
```

### Компоненты

| Компонент | Язык | Расположение | Роль |
|-----------|------|--------------|------|
| Hermes Agent | Python | Внешний процесс | AI-агент, обработка команд, навыки |
| MCP Server | TypeScript | `packages/hermes-mcp-server/` | MCP tools → HTTP proxy к gateway |
| Hermes Gateway | TypeScript | `apps/hermes-gateway/` | API gateway с auth, audit, safe-mode |

### Поток запроса

1. Оператор отправляет команду через Telegram/Discord
2. Agent обрабатывает через LLM (NousResearch или другой provider)
3. Agent вызывает MCP tool (например, `list_plans`)
4. MCP server делает HTTP-запрос к Hermes Gateway
5. Gateway проксирует к domain-сервисам (execution, portfolio, risk)
6. Результат возвращается оператору через messaging platform

## 3. Security

### API Authentication
- Gateway требует `x-hermes-api-key` header
- MCP server хранит ключ в env `HERMES_API_KEY`
- Ключи ротируются через key rotation runbook

### Command Approval
- Чтение (read-only): выполняется без подтверждения
- Запись (mutations): требует explicit approval оператора
  - `arm_plan` → подтверждение с preview
  - `enable_safe_mode` / `disable_safe_mode` → подтверждение
  - `resolve_incident` → подтверждение с указанием причины

### Audit Trail
- Все mutation-запросы логируются через audit-service
- Agent передаёт `operatorId` в каждом запросе
- Gateway добавляет audit entry с `sourceModule: hermes-agent`

## 4. Deployment

### Hermes Agent (внешний процесс)
- **Не входит в monorepo** — отдельный репозиторий или standalone deployment
- Python 3.11+ runtime
- Конфигурация через YAML/env
- Подключается к MCP server через stdio или SSE transport

### MCP Server (в monorepo)
- Пакет `@arbibot/hermes-mcp-server` в `packages/`
- Build через turbo, входит в CI
- Запускается как standalone process или embedded в Agent

### Hermes Gateway (в monorepo)
- `apps/hermes-gateway/` — NestJS + Fastify, порт 3020
- Работает как обычный backend-сервис

## 5. Messaging Platforms

### Telegram Bot
- Команды: `/status`, `/plans`, `/positions`, `/incidents`
- Alerts: critical incidents, reconciliation mismatches
- Approvals: inline keyboard для confirm/reject

### Discord Bot
- Slash commands: `/hermes status`, `/hermes plans`
- Alerts: webhook в designated channel
- Approvals: button components

### Notification Routing
```yaml
notifications:
  critical:
    - telegram: [operator_chat_id]
    - discord: [alerts_channel_id]
  info:
    - telegram: [info_chat_id]
  cron_reports:
    - discord: [reports_channel_id]
```

## 6. Skills

Arbibot-специфичные навыки (6 штук):

| Skill | Описание | MCP Tools |
|-------|----------|-----------|
| `status_check` | Обзор состояния системы | `get_dashboard_summary`, `get_safe_mode_status` |
| `plan_review` | Анализ execution plans | `list_plans`, `get_plan` |
| `position_overview` | Обзор портфеля | `list_positions` |
| `incident_management` | Управление инцидентами | `list_incidents`, `resolve_incident`, `list_incident_briefs` |
| `safe_mode_control` | Управление safe mode | `get_safe_mode_status`, `enable_safe_mode`, `disable_safe_mode` |
| `approval_handler` | Обработка approvals | `get_approvals_queue` |

Каждый skill:
- Определён как YAML конфигурация
- Маппит intent к набору MCP tools
- Содержит prompt template для LLM
- Включает guardrails (read-only vs mutation)

## 7. Cron Scheduling

Периодические задачи через Agent:

| Schedule | Задача | Действие |
|----------|--------|----------|
| `*/15 * * * *` | Status heartbeat | `get_dashboard_summary` → log |
| `0 */6 * * *` | Reconciliation report | `list_incidents` → summarize → notify |
| `0 9 * * *` | Daily risk summary | `list_positions`, `get_safe_mode_status` → report |
| `*/5 * * * *` | Approval queue check | `get_approvals_queue` → notify if pending |

Реализация: APScheduler (Python) или cron + Agent CLI.

## 8. Memory & Learning

### Operator Context
- Agent запоминает предпочтения оператора (формат отчётов, частоту уведомлений)
- Хранение: SQLite или Redis (локально у Agent)

### Session State
- Текущая сессия оператора (открытые инциденты, активные plans)
- TTL-based expiry для stale context

### Learning
- Feedback loop: operator ratings на ответы агента
- Fine-tuning data collection (опционально, future)

## 9. Конфигурация Agent

```yaml
# hermes-agent.yaml (пример)
agent:
  name: hermes-agent
  provider: nousresearch  # или openai, anthropic
  model: hermes-3-llama-3.1-405b
  mcp_server:
    transport: stdio  # или sse
    command: node packages/hermes-mcp-server/dist/index.js
    env:
      HERMES_GATEWAY_URL: http://localhost:3020
      HERMES_API_KEY: ${HERMES_API_KEY}

messaging:
  telegram:
    enabled: true
    token: ${TELEGRAM_BOT_TOKEN}
    allowed_users: [${OPERATOR_TELEGRAM_ID}]
  discord:
    enabled: false

skills:
  - name: status_check
    tools: [get_dashboard_summary, get_safe_mode_status]
    readonly: true
  - name: plan_review
    tools: [list_plans, get_plan, arm_plan, execute_plan]
    readonly: false
    approval_required: [arm_plan, execute_plan]

cron:
  enabled: true
  timezone: UTC
  jobs:
    - schedule: "*/15 * * * *"
      skill: status_check
      notify: [telegram]
```

## 10. Решение

**Принята архитектура Agent → MCP → Gateway** с обоснованием:

1. **MCP как abstraction layer** — Agent не знает о HTTP API напрямую
2. **Gateway как single enforcement point** — auth, rate limiting, audit
3. **Внешний Agent** — не загрязняет monorepo Python-зависимостями
4. **Skills как конфигурация** — легко добавлять новые навыки без кода

## Rollback

Удалить ADR файл и связанные конфигурации.