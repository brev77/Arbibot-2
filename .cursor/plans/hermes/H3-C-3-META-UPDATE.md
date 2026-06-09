# H3-C-3-META-UPDATE — AGENTS.md + .cursorrules update

| Поле | Значение |
|------|----------|
| **depends_on** | `H3-C-2-SKILLS` |
| **risk_level** | `medium` |
| **estimated_hours** | 1 |
| **status** | planned |

## Outputs
Обновлённые метаданные для Phase C

## Файлы
- `AGENTS.md` — добавить:
  - `packages/hermes-mcp-server` в shared packages table
  - `tools/hermes-agent/` описание
  - MCP tools reference
  - Hermes Agent setup instructions
  - New env vars: `HERMES_MCP_PORT`, `HERMES_AGENT_API_KEY`
- `.cursorrules` — добавить:
  - Hermes Agent integration notes
  - MCP server как часть стека
- `README.md` — добавить:
  - Hermes MCP server в packages table
  - Agent setup section
- `.cursor/plans/DEVELOPMENT_PLAN.md` — отметить Phase 5 как hermes-based

## New env vars
| Variable | Default | Description |
|----------|---------|-------------|
| `HERMES_MCP_PORT` | 4000 | MCP server port |
| `HERMES_AGENT_API_KEY` | — | API key для MCP auth |

## Test Commands
```bash
findstr /i "hermes-mcp\|hermes-agent" AGENTS.md README.md
```

## Rollback
`git checkout -- AGENTS.md README.md .cursorrules`