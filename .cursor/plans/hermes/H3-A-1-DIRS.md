# H3-A-1-DIRS — Переименование директорий

| Поле | Значение |
|------|----------|
| **depends_on** | `H3-A-0-ADR` |
| **risk_level** | `high` |
| **estimated_hours** | 1 |
| **status** | planned |

## Outputs
- `apps/hermes-gateway/` (из `apps/HERMES-gateway/`)
- `apps/hermes-gateway/src/hermes/` (из `src/HERMES/`)
- `apps/web/app/(operator)/hermes/` (из `HERMES/`)
- `apps/web/app/api/operator/hermes/` (из `HERMES/`)
- `apps/web/components/hermes/` (из `HERMES/`)

## Порядок
1. `git mv apps/HERMES-gateway apps/hermes-gateway`
2. `git mv apps/hermes-gateway/src/HERMES apps/hermes-gateway/src/hermes`
3. `git mv "apps/web/app/(operator)/HERMES" "apps/web/app/(operator)/hermes"`
4. `git mv "apps/web/app/api/operator/HERMES" "apps/web/app/api/operator/hermes"`
5. `git mv apps/web/components/HERMES apps/web/components/hermes`
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