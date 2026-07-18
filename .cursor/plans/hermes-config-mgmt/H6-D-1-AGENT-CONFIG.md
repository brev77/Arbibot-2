# H6-D-1-AGENT-CONFIG — hermes-config.yaml + .env/README

| Поле | Значение |
|------|----------|
| **depends_on** | `H6-C-2-MCP-TOOLS` |
| **risk_level** | `low` |
| **status** | done |

## Outputs
- `tools/hermes-agent/hermes-config.yaml`: `security.approval_required` += `update_config`, `rollback_config`, `promote_config`, `activate_config`; `messaging.telegram.commands` += `/config → skill:config_management`.
- `.env.example`: `# HERMES_OPERATOR_ID=` (fallback на `OPERATOR_TELEGRAM_ID`).
- `tools/hermes-agent/README.md`: команда `/config`, +8 tools (секция «Config management (Plan 6)»), `HERMES_OPERATOR_ID` в env-таблице.

## Test
- `grep update_config tools/hermes-agent/hermes-config.yaml` → найдено.
