# D4-A-1-AUTH — Реализация операторского auth

| Поле | Значение |
|------|----------|
| **depends_on** | `D4-A-0-ADR` |
| **risk_level** | `high` |
| **estimated_hours** | 8 |
| **status** | `done` |

## Контекст (из ревью)
Подписанная httpOnly-сессия вместо неподписанной `arbibot_role` (P1, critical для любого не-localhost).

## Outputs
- `apps/web/lib/auth/session.ts` — подписка/проверка сессии (HMAC или jose/JWT)
- `apps/web/app/auth/...` — endpoint выдачи сессии (после проверки учётки/dev-trust)
- Обновить `apps/web/middleware.ts:12` и `apps/web/lib/operator-session.ts:30` на чтение из подписанной сессии
- `OPERATOR_SESSION_SECRET` env (≥32 байт), fail-closed если отсутствует в prod
- `.env.production.example` — добавить `OPERATOR_SESSION_SECRET=<CHANGE_ME_USE_VAULT>`

## Acceptance
- [x] Кука `arbibot_role` более не читается напрямую; читается подписанная сессия — `apps/web/lib/auth/session.ts`, `middleware.ts:4,16-17`, `lib/operator-session.ts:3,17`
- [x] Подделанная `arbibot_role=admin` **не** даёт admin-доступ — тест `middleware.test.ts:95`
- [x] `OPERATOR_SESSION_SECRET` отсутствует в prod → fail-closed (503/redirect) — `session.ts:68-72`, `tools/validate-env.sh:123-126`
- [x] BFF-роуты `apps/web/app/api/operator/**` валидируют сессию серверно — `middleware.ts:53-57`
- [x] Dev-режим через `ARBIBOT_DEV_ROLE` сохранён только при `NODE_ENV !== 'production'` — `middleware.ts:24`, `validate-env.sh:287-289`
- [x] Юнит-тест на подделанную куку; интеграционный тест на admin-маршрут без сессии → 401/403 — `middleware.test.ts`, `session.test.ts:97-111`

## Edge Cases
- Истёкшая сессия → redirect на login (не silent role=viewer)
- Rotate `OPERATOR_SESSION_SECRET` → инвалидация всех сессий (задокументировать)

## Test Commands
```bash
npm run lint -w @arbibot/web
npm run build -w @arbibot/web
npm run test -w @arbibot/web
```

## Rollback
`git checkout -- apps/web/middleware.ts apps/web/lib/operator-session.ts apps/web/lib/` + удалить `apps/web/lib/auth/`
