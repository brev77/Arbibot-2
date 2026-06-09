# H3-B-3-TESTS — Тесты MCP server + turbo integration

| Поле | Значение |
|------|----------|
| **depends_on** | `H3-B-2-TOOLS` |
| **risk_level** | `medium` |
| **estimated_hours** | 3 |
| **status** | planned |

## Outputs
- `packages/hermes-mcp-server/src/**/*.spec.ts`
- Интеграция в `turbo.json`

## Тесты
- Unit: каждый tool с mock HTTP client
- Integration: tool → hermes-client → mock gateway
- Errors: timeout, 429, 401, 404, 500
- Schema validation: input/output JSON Schema

## Edge Cases
- turbo.json: lint/build/test pipelines для нового пакета
- coverage >80%

## Test Commands
```bash
npm run test -w @arbibot/hermes-mcp-server
npm run build   # 22 пакета (21 + новый)
npm run lint -w @arbibot/hermes-mcp-server
```

## Rollback
`git checkout -- packages/hermes-mcp-server/`