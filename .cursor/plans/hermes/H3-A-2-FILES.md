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
- `openclaw-env.ts` → `hermes-env.ts`
- `openclaw-auth.guard.ts` → `hermes-auth.guard.ts`
- `openclaw-auth.guard.spec.ts` → `hermes-auth.guard.spec.ts`
- `openclaw-mutation-rate-limit.guard.ts` → `hermes-mutation-rate-limit.guard.ts`
- `openclaw-mutation.controller.ts` → `hermes-mutation.controller.ts`
- `openclaw-mutation.service.ts` → `hermes-mutation.service.ts`
- `openclaw-mutation.service.spec.ts` → `hermes-mutation.service.spec.ts`
- `openclaw-rate-limit.service.ts` → `hermes-rate-limit.service.ts`
- `openclaw-upstream.service.ts` → `hermes-upstream.service.ts`
- `openclaw.controller.ts` → `hermes.controller.ts`
- `openclaw.module.ts` → `hermes.module.ts`

## Web (3 файла)
- `apps/web/lib/openclaw-bff.ts` → `hermes-bff.ts`
- `apps/web/lib/openclaw-types.ts` → `hermes-types.ts`
- `apps/web/components/hermes/openclaw-workspace.tsx` → `hermes-workspace.tsx`

## Test Commands
```bash
ls apps/hermes-gateway/src/hermes/hermes-*.ts
ls apps/web/lib/hermes-*.ts
```

## Rollback
`git checkout -- .`