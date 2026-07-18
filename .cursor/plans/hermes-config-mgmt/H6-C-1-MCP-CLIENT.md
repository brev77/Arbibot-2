# H6-C-1-MCP-CLIENT — HermesClient.put/patch + operatorId

| Поле | Значение |
|------|----------|
| **depends_on** | `H6-B-3-GATEWAY-CONTROLLER` |
| **risk_level** | `low` |
| **status** | done |

## Outputs
- `packages/hermes-mcp-server/src/hermes-client.ts`.

## Изменения
- `put<T>(path, body)` и `patch<T>(path, body)` (по образцу `post`).
- `operatorId` (readonly getter): `process.env.HERMES_OPERATOR_ID ?? process.env.OPERATOR_TELEGRAM_ID`.

## Test
- Существующий `hermes-client.spec.ts` проходит; новый `config.spec.ts` проверяет что operatorId подставляется в mutations.
