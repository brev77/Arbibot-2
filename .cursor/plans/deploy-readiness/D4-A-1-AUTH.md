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
- [ ] Кука `arbibot_role` более не читается напрямую; читается подписанная сессия
- [ ] Подделанная `arbibot_role=admin` **не** даёт admin-доступ
- [ ] `OPERATOR_SESSION_SECRET` отсутствует в prod → fail-closed (503/redirect)
- [ ] BFF-роуты `apps/web/app/api/operator/**` валидируют сессию серверно
- [ ] Dev-режим через `ARBIBOT_DEV_ROLE` сохранён только при `NODE_ENV !== 'production'`
- [ ] Юнит-тест на подделанную куку; интеграционный тест на admin-маршрут без сессии → 401/403

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
