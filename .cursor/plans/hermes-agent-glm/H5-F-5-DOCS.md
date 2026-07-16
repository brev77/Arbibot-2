# H5-F-5-DOCS — План + файлы шагов + AGENTS.md

| Поле | Значение |
|------|----------|
| **depends_on** | `H5-E-4-DOCKER` |
| **risk_level** | `low` (документация) |
| **status** | done |

## Outputs
- `.cursor/plans/DEVELOPMENT_PLAN5.md` — индекс плана.
- `.cursor/plans/hermes-agent-glm/H5-*.md` — 7 файлов деталей шагов.
- `AGENTS.md` — пометка в разделе «Hermes Agent + MCP Server (Plan 3)».

## Edge Cases
- `docs/hermes-gateway-runbook.md` и `docs/hermes-reference.md` НЕ правились: в них нет утверждений «provider: nousresearch по умолчанию», которые надо менять.

## Test
```bash
test -f .cursor/plans/DEVELOPMENT_PLAN5.md && echo OK
ls .cursor/plans/hermes-agent-glm/ | wc -l   # 7
grep -c "Plan 5" AGENTS.md                    # >= 1
```
