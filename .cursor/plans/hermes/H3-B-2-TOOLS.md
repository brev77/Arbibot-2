# H3-B-2-TOOLS — Реализация MCP tools (14 tools)

| Поле | Значение |
|------|----------|
| **depends_on** | `H3-B-1-PACKAGE` |
| **risk_level** | `medium` |
| **estimated_hours** | 4 |
| **status** | planned |

## Outputs
- `src/tools/plans.ts` — list_plans, get_plan, arm_plan, execute_plan
- `src/tools/positions.ts` — list_positions, close_position
- `src/tools/incidents.ts` — list_incidents, resolve_incident, list_incident_briefs
- `src/tools/safe-mode.ts` — get_status, enable, disable
- `src/tools/audit.ts` — get_approvals_queue
- `src/tools/dashboard.ts` — get_dashboard_summary

## Каждый tool
- JSON Schema input/output
- HTTP вызов к hermes-gateway
- Error handling
- Audit через gateway (не напрямую)

## Edge Cases
- Mutation tools: confirmation в MCP protocol
- Rate limiting (429): retry/circuit breaker
- Timeout: gateway недоступен

## Test Commands
```bash
npm run build -w @arbibot/hermes-mcp-server
```

## Rollback
`git checkout -- packages/hermes-mcp-server/src/tools/`