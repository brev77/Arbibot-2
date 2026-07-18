# H6-E-3-DOCS — план + файлы шагов + AGENTS.md + gateway README

| Поле | Значение |
|------|----------|
| **depends_on** | `H6-D-2-AGENT-SKILL` |
| **risk_level** | `low` |
| **status** | done |

## Outputs
- `.cursor/plans/DEVELOPMENT_PLAN6.md` — индекс.
- `.cursor/plans/hermes-config-mgmt/H6-*.md` — 10 файлов шагов.
- `AGENTS.md` — update-блок Plan 6.
- `apps/hermes-gateway/README.md` — routes `/hermes/v1/config/*` + env `CONFIG_API_BASE`.

## Test
- Индекс и 10 файлов шагов существуют.
- `AGENTS.md` упоминает Plan 6.
