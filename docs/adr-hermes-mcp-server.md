# ADR: Hermes MCP Server Architecture

**Status:** Accepted  
**Date:** 2026-06-10  
**Context:** H3-B-0-ADR-MCP

## Context

Hermes Agent (AI-агент на базе NousResearch/Hermes) нуждается в структурированном доступе к операционным данным Arbibot 2. MCP (Model Context Protocol) предоставляет стандартизированный способ暴露 tools для AI-агентов.

Hermes gateway уже имеет REST API (`/hermes/v1/`) с аутентификацией через `x-hermes-api-key`. MCP server будет тонким слоем, транслирующим MCP tool calls в HTTP-запросы к gateway.

## Decision

Создать **TypeScript MCP server** в `packages/hermes-mcp-server/`:

1. **Transport:** stdio (для локального запуска агентом) + опционально SSE (для remote)
2. **Инструменты:** 14 MCP tools, каждый маппится на HTTP endpoint hermes-gateway
3. **Аутентификация:** API key (`HERMES_API_KEY`) пробрасывается в `x-hermes-api-key` header
4. **Пакет:** `@arbibot/hermes-mcp-server`, собирается через `tsc`, интегрирован в turbo pipeline

### Архитектура

```
Hermes Agent (Python)
    ↓ MCP protocol (stdio)
hermes-mcp-server (TypeScript)
    ↓ HTTP (x-hermes-api-key)
hermes-gateway (NestJS, port 3020)
    ↓ HTTP
Domain services (execution, portfolio, reconciliation, audit)
```

### MCP Tools (14)

| MCP Tool | Gateway Endpoint | Method | Description |
|----------|-----------------|--------|-------------|
| `list_plans` | `/hermes/v1/plans` | GET | Список execution plans |
| `get_plan` | `/hermes/v1/plans/:id` | GET | Детали plan + legs |
| `list_positions` | `/hermes/v1/positions` | GET | Портфельные позиции |
| `close_position` | `/hermes/v1/positions/:id/close` | POST | Закрыть позицию (mutation) |
| `list_incidents` | `/hermes/v1/incidents` | GET | Reconciliation инциденты |
| `resolve_incident` | `/hermes/v1/incidents/:id/resolve` | POST | Разрешить инцидент (mutation) |
| `get_dashboard_summary` | `/hermes/v1/dashboard/summary` | GET | Сводка дашборда |
| `get_approvals_queue` | `/hermes/v1/approvals-queue` | GET | Очередь approve-заявок |
| `get_safe_mode_status` | `/hermes/v1/safe-mode/status` | GET | Статус safe mode |
| `enable_safe_mode` | `/hermes/v1/safe-mode/enable` | POST | Включить safe mode (mutation) |
| `disable_safe_mode` | `/hermes/v1/safe-mode/disable` | POST | Выключить safe mode (mutation) |
| `arm_plan` | `/hermes/v1/plans/:id/arm` | POST | Arm plan (mutation) |
| `execute_plan` | `/hermes/v1/plans/:id/execute` | POST | Execute plan (mutation) |
| `list_incident_briefs` | `/hermes/v1/incident-briefs` | GET | Краткие сводки инцидентов |

### Security

- **API Key:** `HERMES_API_KEY` env var → `x-hermes-api-key` header к gateway
- **Rate Limiting:** Наследуется от gateway (`HERMES_MUTATION_RATE_LIMIT_*`)
- **Audit Trail:** Mutation tools логируются через gateway audit
- **Safe Mode:** Mutation tools не работают в safe mode (наследуется от gateway)

### Структура пакета

```
packages/hermes-mcp-server/
├── package.json          # @arbibot/hermes-mcp-server
├── tsconfig.json
├── src/
│   ├── index.ts          # MCP server entry, stdio transport
│   ├── server.ts         # Server setup, tool registration
│   ├── gateway-client.ts # HTTP client to hermes-gateway
│   └── tools/
│       ├── index.ts      # Tool registry
│       ├── plans.ts      # list_plans, get_plan, arm_plan, execute_plan
│       ├── positions.ts  # list_positions, close_position
│       ├── incidents.ts  # list_incidents, resolve_incident, list_incident_briefs
│       ├── dashboard.ts  # get_dashboard_summary, get_approvals_queue
│       └── safe-mode.ts  # get_safe_mode_status, enable_safe_mode, disable_safe_mode
└── __tests__/
    └── server.spec.ts    # Unit tests
```

## Alternatives Considered

### 1. Python MCP Server
- **Плюс:** Единый язык с агентом
- **Минус:** Дублирование типов, отсутствие переиспользования TypeScript контрактов, второй runtime
- **Вердикт:** Отклонено — TypeScript предпочтительнее для consistency с монорепо

### 2. Direct HTTP от агента
- **Плюс:** Проще, без промежуточного слоя
- **Минус:** Агент жёстко привязан к REST API, нет стандартизации через MCP protocol
- **Вердикт:** Отклонено — MCP даёт стандартизированный interface для tool discovery и вызовов

### 3. MCP Server внутри hermes-gateway
- **Плюс:** Нет отдельного пакета
- **Минус:** Нарушает separation of concerns, gateway становится MCP-aware
- **Вердикт:** Отклонено — gateway должен оставаться чистым HTTP proxy

## Consequences

- **Positive:** Стандартизированный MCP interface для AI-агента; переиспользование gateway auth/rate-limiting/audit
- **Positive:** MCP server можно тестировать независимо от агента
- **Neutral:** Добавляется один npm-пакет в монорепо
- **Risk:** MCP protocol может потребовать обновления при смене версии spec

## Rollback

Удалить `packages/hermes-mcp-server/` и ADR файл.