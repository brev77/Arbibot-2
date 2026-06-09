# H3-A-1-DIRS — Переименование директорий

| Поле | Значение |
|------|----------|
| **depends_on** | `H3-A-0-ADR` |
| **risk_level** | `high` |
| **estimated_hours** | 1 |
| **status** | planned |

## Outputs
- `apps/hermes-gateway/` (из `apps/openclaw-gateway/`)
- `apps/hermes-gateway/src/hermes/` (из `src/openclaw/`)
- `apps/web/app/(operator)/hermes/` (из `openclaw/`)
- `apps/web/app/api/operator/hermes/` (из `openclaw/`)
- `apps/web/components/hermes/` (из `openclaw/`)

## Порядок
1. `git mv apps/openclaw-gateway apps/hermes-gateway`
2. `git mv apps/hermes-gateway/src/openclaw apps/hermes-gateway/src/hermes`
3. `git mv "apps/web/app/(operator)/openclaw" "apps/web/app/(operator)/hermes"`
4. `git mv "apps/web/app/api/operator/openclaw" "apps/web/app/api/operator/hermes"`
5. `git mv apps/web/components/openclaw apps/web/components/hermes`
6. Удалить `apps/hermes-gateway/dist/` и `apps/web/.next/`

## Edge Cases
- `.next/` и `dist/` кэши — удалить перед сборкой
- `git mv` на Windows: кавычки для путей с `(` и `)`

## Test Commands
```bash
ls apps/hermes-gateway/src/hermes/
ls "apps/web/app/(operator)/hermes/"
```

## Rollback
`git checkout -- .` или `git reset --hard HEAD` (до коммита)