# H3-A-7-META — Обновление метаданных

| Поле | Значение |
|------|----------|
| **depends_on** | `H3-A-6-DOCS` |
| **risk_level** | `medium` |
| **estimated_hours** | 1 |
| **status** | planned |

## Outputs
Обновлённые метаданные проекта

## Файлы
- `AGENTS.md` — service table, env vars, dev command, BFF route, UI route, docs links, Phase 5 descriptions (~20+ строк)
- `README.md` — service table, npm script, port table, docs links
- `.cursorrules` — упоминания HERMES
- `.cursor/plans/DEVELOPMENT_PLAN.md` — Phase 5 step descriptions
- `.cursor/skills/*/SKILL.md` — если упоминают HERMES
- `.cursor/commands/*.md` — если упоминают HERMES
- `!Arbibot_2_Architecture_v1_final_docs_settings.md` — если содержит упоминания
- `!Arbibot_2_Frontend_Spec_settings.md` — если содержит упоминания

## Также обновить
- `apps/portfolio-service/src/positions/positions.controller.ts` — комментарий "HERMES / manual"
- `packages/persistence/src/portfolio-position-close-idempotency.entity.ts` — комментарий

## Edge Cases
- `.cursorrules` = system prompt — ошибки влияют на все ответы
- AGENTS.md используется всеми agents — быть точным

## Test Commands
```bash
findstr /i "HERMES" AGENTS.md README.md .cursorrules  # → 0 результатов
```

## Rollback
`git checkout -- AGENTS.md README.md .cursorrules`