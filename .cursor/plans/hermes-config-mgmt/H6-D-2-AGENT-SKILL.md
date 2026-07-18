# H6-D-2-AGENT-SKILL — skills/config-management.md

| Поле | Значение |
|------|----------|
| **depends_on** | `H6-D-1-AGENT-CONFIG` |
| **risk_level** | `low` |
| **status** | done |

## Outputs
- `tools/hermes-agent/skills/config-management.md`.

## Содержание
Skill для управления настройками: frontmatter (8 tools, 4 в `approval_required`), trigger patterns (RU+EN), последовательность (сначала чтение → подтверждение → mutation), явный **Guardrails**: только безопасные ключи (intake/paper/opportunity/dex/features), sensitive → направить в UI, всегда показывать текущее значение и просить approveReason. Упоминает, что `dex.limits.killSwitch` доступен (экстренная остановка live).

## Test
- Файл существует, frontmatter валиден, содержит «Guardrails».
