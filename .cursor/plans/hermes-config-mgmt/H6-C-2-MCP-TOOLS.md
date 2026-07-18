# H6-C-2-MCP-TOOLS — tools/config.ts (8 tools) + tests + index

| Поле | Значение |
|------|----------|
| **depends_on** | `H6-C-1-MCP-CLIENT` |
| **risk_level** | `medium` |
| **status** | done |

## Outputs
- `packages/hermes-mcp-server/src/tools/config.ts` — 8 tools (4 read + 4 mutation).
- `packages/hermes-mcp-server/src/tools/index.ts` — `registerConfigTools` подключён, комментарий «22 tools».
- `packages/hermes-mcp-server/src/tools/config.spec.ts` — 9 тестов.
- `packages/hermes-mcp-server/src/tools/index.spec.ts` — обновлён (22 tools, +8 имён).

## Tools
- Read: `list_configs`, `get_config`, `get_effective_config`, `get_config_history`.
- Mutation (description содержит "(mutation"): `update_config` (PUT), `rollback_config` (POST), `promote_config` (POST), `activate_config` (PATCH).
- `mutationBody` хелпер: инжектит operatorId, кидает action-ошибку если operatorId не задан.
- Хелперы `buildQuery`/`asStr` устраняют дублирование + прохождение `no-base-to-string` lint.

## Test
- 27 тестов (3 suites) проходят. Lint чист.
