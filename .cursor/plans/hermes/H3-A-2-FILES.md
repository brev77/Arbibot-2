# H3-A-2-FILES — Переименование файлов

| Поле | Значение |
|------|----------|
| **depends_on** | `H3-A-1-DIRS` |
| **risk_level** | `medium` |
| **estimated_hours** | 0.5 |
| **status** | planned |

## Outputs
Переименованные файлы внутри gateway и web

## Gateway (11 файлов → hermes-*)
`src/hermes/`:
- `HERMES-env.ts` → `hermes-env.ts`
- `HERMES-auth.guard.ts` → `hermes-auth.guard.ts`
- `HERMES-auth.guard.spec.ts` → `hermes-auth.guard.spec.ts`
- `HERMES-mutation-rate-limit.guard.ts` → `hermes-mutation-rate-limit.guard.ts`
- `HERMES-mutation.controller.ts` → `hermes-mutation.controller.ts`
- `HERMES-mutation.service.ts` → `hermes-mutation.service.ts`
- `HERMES-mutation.service.spec.ts` → `hermes-mutation.service.spec.ts`
- `HERMES-rate-limit.service.ts` → `hermes-rate-limit.service.ts`
- `HERMES-upstream.service.ts` → `hermes-upstream.service.ts`
- `HERMES.controller.ts` → `hermes.controller.ts`
- `HERMES.module.ts` → `hermes.module.ts`

## Web (3 файла)
- `apps/web/lib/HERMES-bff.ts` → `hermes-bff.ts`
- `apps/web/lib/HERMES-types.ts` → `hermes-types.ts`
- `apps/web/components/hermes/HERMES-workspace.tsx` → `hermes-workspace.tsx`

## Test Commands
```bash
ls apps/hermes-gateway/src/hermes/hermes-*.ts
ls apps/web/lib/hermes-*.ts
```

## Rollback
`git checkout -- .`