# H6-B-1-GATEWAY-UPSTREAM — getConfigApiBase + putJson + env

| Поле | Значение |
|------|----------|
| **depends_on** | `H6-A-1-ALLOWLIST` |
| **risk_level** | `low` |
| **status** | done |

## Outputs
- `hermes-env.ts`: `getConfigApiBase()` (`CONFIG_API_BASE`, default `:3019`).
- `hermes-upstream.service.ts`: `putJson(url, body, correlationId?)` (по образцу patchJson).
- `.env.example`: `# CONFIG_API_BASE=http://127.0.0.1:3019`.

## Test
- `npm run build -w @arbibot/hermes-gateway` — OK.
- Существующий upstream spec проходит.
