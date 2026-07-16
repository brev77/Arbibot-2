# H5-B-1-CONFIG — Конфиг агента (GLM 5.2 + Telegram)

| Поле | Значение |
|------|----------|
| **depends_on** | `H5-A-0-ADR` |
| **risk_level** | `medium` (конфиг runtime) |
| **status** | done |

## Outputs
- `tools/hermes-agent/hermes-config.yaml` — обновлён.
- `tools/hermes-agent/mcp-config.json` — обновлён.

## Изменения
- `agent`: `provider: ${HERMES_LLM_PROVIDER:openai}`, `model: ${HERMES_LLM_MODEL:glm-5.2}`, **+`base_url`** (`https://open.bigmodel.cn/api/paas/v4`), `api_key`.
- `messaging.telegram`: `enabled: ${HERMES_TELEGRAM_ENABLED:true}`; добавлена команда `/explain → skill:explain_bot`.
- `messaging.discord`: `enabled: false` (без изменений по умолчанию).
- `cron.enabled`: `true` (периодические сводки в Telegram).
- `mcp-config.json`: `HERMES_API_KEY: "${HERMES_API_KEY}"` вместо `CHANGE_ME`.

## Edge Cases
- Поле `base_url` отсутствовало в исходном конфиге — добавлено как env-overridable.
- Ничего не зашито жёстко: все значения берутся из env.

## Test
```bash
grep "glm-5.2" tools/hermes-agent/hermes-config.yaml
grep "HERMES_TELEGRAM_ENABLED:true" tools/hermes-agent/hermes-config.yaml
```
