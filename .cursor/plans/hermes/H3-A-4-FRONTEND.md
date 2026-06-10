# H3-A-4-FRONTEND — Замена содержимого frontend

| Поле | Значение |
|------|----------|
| **depends_on** | `H3-A-2-FILES` |
| **risk_level** | `high` |
| **estimated_hours** | 1.5 |
| **status** | planned |

## Outputs
Все файлы `apps/web/` с заменёнными ссылками

## Файлы (~12)
- `app/(operator)/hermes/page.tsx` — импорты
- `app/api/operator/hermes/v1/[[...path]]/route.ts` — env vars
- `components/hermes/hermes-workspace.tsx` — типы, query keys
- `components/operator-nav.tsx` — href, label
- `components/safe-mode-banner.tsx` — query keys, paths
- `lib/hermes-bff.ts` — env vars, API paths
- `lib/hermes-types.ts` — типы
- `lib/operator-query-keys.ts` — query keys
- `lib/operator-role.ts` — pathname check
- `middleware.ts` — matcher

## Маппинг замен
| Было | Стало |
|------|-------|
| `HERMESDashboardSummary` | `HermesDashboardSummary` |
| `HERMESPlan` | `HermesPlan` |
| `HERMESWorkspace` | `HermesWorkspace` |
| `HERMESPlans` | `hermesPlans` |
| `HERMESDashboard` | `hermesDashboard` |
| `HERMES_GATEWAY_URL` | `HERMES_GATEWAY_URL` |
| `HERMES_BFF_API_KEY` | `HERMES_BFF_API_KEY` |
| `HERMES_GATEWAY_API_KEY` | `HERMES_GATEWAY_API_KEY` |
| `HERMES-bff` | `hermes-bff` |
| `HERMES-types` | `hermes-types` |

## Edge Cases
- `.next/` удалить перед пересборкой
- React Query keys — заменить все для invalidation

## Test Commands
```bash
npm run build -w @arbibot/web
npm run lint -w @arbibot/web
```

## Rollback
`git checkout -- apps/web/`