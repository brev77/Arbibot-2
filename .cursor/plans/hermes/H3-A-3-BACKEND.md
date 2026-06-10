# H3-A-3-BACKEND — Замена содержимого backend

| Поле | Значение |
|------|----------|
| **depends_on** | `H3-A-2-FILES` |
| **risk_level** | `high` |
| **estimated_hours** | 2 |
| **status** | planned |

## Outputs
Все файлы `apps/hermes-gateway/` с заменёнными ссылками

## Файлы (~21)
`src/`: `main.ts`, `app.module.ts`, `health/health.controller.ts`
`src/hermes/`: все `hermes-*.ts`, `safe-mode.*`, `incident-briefs.*`, `dto/*`
Root: `package.json`, `README.md`, `nest-cli.json`

## Маппинг замен
| Было | Стало |
|------|-------|
| `HERMESModule` | `HermesModule` |
| `HERMESController` | `HermesController` |
| `HERMESAuthGuard` | `HermesAuthGuard` |
| `HERMESMutationController` | `HermesMutationController` |
| `HERMESMutationService` | `HermesMutationService` |
| `HERMESMutationRateLimitGuard` | `HermesMutationRateLimitGuard` |
| `HERMESRateLimitService` | `HermesRateLimitService` |
| `HERMESUpstreamService` | `HermesUpstreamService` |
| `HERMES_API_KEYS` | `HERMES_API_KEYS` |
| `HERMES_GATEWAY_PORT` | `HERMES_GATEWAY_PORT` |
| `HERMES_SAFE_MODE_*` | `HERMES_SAFE_MODE_*` |
| `HERMES_MUTATION_RATE_LIMIT_*` | `HERMES_MUTATION_RATE_LIMIT_*` |
| `x-HERMES-api-key` | `x-hermes-api-key` |
| `/HERMES/v1/` | `/hermes/v1/` |
| `'HERMES-gateway'` | `'hermes-gateway'` |
| `@arbibot/HERMES-gateway` | `@arbibot/hermes-gateway` |

## Edge Cases
- `nest-cli.json`: `src/HERMES/` → `src/hermes/`
- `dist/` удалить перед пересборкой

## Test Commands
```bash
npm run build -w @arbibot/hermes-gateway
npm run test -w @arbibot/hermes-gateway
```

## Rollback
`git checkout -- apps/hermes-gateway/`