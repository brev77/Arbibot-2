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
| `OpenclawModule` | `HermesModule` |
| `OpenclawController` | `HermesController` |
| `OpenclawAuthGuard` | `HermesAuthGuard` |
| `OpenclawMutationController` | `HermesMutationController` |
| `OpenclawMutationService` | `HermesMutationService` |
| `OpenclawMutationRateLimitGuard` | `HermesMutationRateLimitGuard` |
| `OpenclawRateLimitService` | `HermesRateLimitService` |
| `OpenclawUpstreamService` | `HermesUpstreamService` |
| `OPENCLAW_API_KEYS` | `HERMES_API_KEYS` |
| `OPENCLAW_GATEWAY_PORT` | `HERMES_GATEWAY_PORT` |
| `OPENCLAW_SAFE_MODE_*` | `HERMES_SAFE_MODE_*` |
| `OPENCLAW_MUTATION_RATE_LIMIT_*` | `HERMES_MUTATION_RATE_LIMIT_*` |
| `x-openclaw-api-key` | `x-hermes-api-key` |
| `/openclaw/v1/` | `/hermes/v1/` |
| `'openclaw-gateway'` | `'hermes-gateway'` |
| `@arbibot/openclaw-gateway` | `@arbibot/hermes-gateway` |

## Edge Cases
- `nest-cli.json`: `src/openclaw/` → `src/hermes/`
- `dist/` удалить перед пересборкой

## Test Commands
```bash
npm run build -w @arbibot/hermes-gateway
npm run test -w @arbibot/hermes-gateway
```

## Rollback
`git checkout -- apps/hermes-gateway/`