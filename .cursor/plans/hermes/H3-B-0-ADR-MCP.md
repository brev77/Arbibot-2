# H3-B-0-ADR-MCP — ADR: MCP server architecture

| Поле | Значение |
|------|----------|
| **depends_on** | `H3-A-8-VERIFY` |
| **risk_level** | `low` |
| **estimated_hours** | 1 |
| **status** | planned |

## Outputs
- `docs/adr-hermes-mcp-server.md`

## Содержание ADR
1. Контекст: Hermes Agent использует MCP protocol
2. Решение: TypeScript MCP server в `packages/hermes-mcp-server/`
3. Security: API key auth, rate limiting, audit trail
4. Альтернативы: Python MCP server, direct HTTP

## MCP Tools → Gateway (14 tools)
| MCP Tool | Endpoint | Method |
|----------|----------|--------|
| `list_plans` | `/hermes/v1/plans` | GET |
| `get_plan` | `/hermes/v1/plans/:id` | GET |
| `list_positions` | `/hermes/v1/positions` | GET |
| `close_position` | `/hermes/v1/positions/:id/close` | POST |
| `list_incidents` | `/hermes/v1/incidents` | GET |
| `resolve_incident` | `/hermes/v1/incidents/:id/resolve` | POST |
| `get_dashboard_summary` | `/hermes/v1/dashboard/summary` | GET |
| `get_approvals_queue` | `/hermes/v1/approvals-queue` | GET |
| `get_safe_mode_status` | `/hermes/v1/safe-mode/status` | GET |
| `enable_safe_mode` | `/hermes/v1/safe-mode/enable` | POST |
| `disable_safe_mode` | `/hermes/v1/safe-mode/disable` | POST |
| `arm_plan` | `/hermes/v1/plans/:id/arm` | POST |
| `execute_plan` | `/hermes/v1/plans/:id/execute` | POST |
| `list_incident_briefs` | `/hermes/v1/incident-briefs` | GET |

## Rollback
Удалить ADR файл