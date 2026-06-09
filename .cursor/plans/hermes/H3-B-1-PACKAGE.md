# H3-B-1-PACKAGE — Skeleton packages/hermes-mcp-server/

| Поле | Значение |
|------|----------|
| **depends_on** | `H3-B-0-ADR-MCP` |
| **risk_level** | `medium` |
| **estimated_hours** | 2 |
| **status** | planned |

## Outputs
- `packages/hermes-mcp-server/package.json` — `@arbibot/hermes-mcp-server`
- `packages/hermes-mcp-server/tsconfig.json`
- `packages/hermes-mcp-server/src/index.ts` — MCP server entry, tool registration
- `packages/hermes-mcp-server/src/config.ts` — `HERMES_GATEWAY_URL`, `HERMES_API_KEY`
- `packages/hermes-mcp-server/src/hermes-client.ts` — HTTP client to gateway

## Зависимости
- `@modelcontextprotocol/sdk` — MCP TypeScript SDK
- Native `fetch` для HTTP

## Структура
```
packages/hermes-mcp-server/
├── package.json
├── tsconfig.json    # extends packages/tsconfig/base.json
└── src/
    ├── index.ts
    ├── config.ts
    └── hermes-client.ts
```

## Edge Cases
- MCP SDK: Node.js 18+ совместимость
- TypeScript strict mode обязателен

## Test Commands
```bash
npm run build -w @arbibot/hermes-mcp-server
```

## Rollback
`git rm -r packages/hermes-mcp-server/`