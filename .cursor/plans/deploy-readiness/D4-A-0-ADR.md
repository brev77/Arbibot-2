# D4-A-0-ADR — ADR: операторская аутентификация для prod

| Поле | Значение |
|------|----------|
| **depends_on** | — |
| **risk_level** | `high` |
| **estimated_hours** | 2 |
| **status** | `done` |

## Контекст (из ревью)

`apps/web/middleware.ts:12` и `apps/web/lib/operator-session.ts:30` читают роль из **неподписанной** куки `arbibot_role`. Нет JWT/IdP/login/session-store (`jsonwebtoken`, `iron-session`, `next-auth`, `jose` — grep пустой). `ARBIBOT_DEV_ROLE` в prod корректно отключён (`NODE_ENV !== 'production'`, F4 закрыт), но кука — bearer-токен без выдачи/проверки. Защита = только сетевой доступ (nginx).

## Outputs
- `docs/adr-operator-auth.md` — ADR с выбранным механизмом (см. Options)

## Options (решить в ADR)
1. **HTTP-only подписанная кука** (HMAC через `iron-session`/`jose`), выдаваемая сервером после проверки (dev: trust proxy header; prod: внешний IdP/OIDC). Минимум усилий, закрывает bearer-проблем.
2. **NextAuth/Auth.js** с одним провайдером (Credentials или OIDC) + session в signed cookie.
3. **Внешний IdP (Keycloak/Authelia)** перед nginx; nginx прокидывает trusted header → middleware читает header только при `NODE_ENV=production` + `TRUSTED_AUTH_HEADER`.

## Decision criteria
- Доступность для paper-deploy на изолированном хосте (без внешнего IdP).
- Совместимость с существующей роль-моделью `apps/web/lib/operator-role.ts` (viewer/operator/admin).
- Должно работать в RSC (BFF-роуты) и middleware (Edge).

## Edge Cases
- BFF-роуты (`apps/web/app/api/operator/**`) тоже должны валидировать сессию серверно.
- Dev-режим сохраняется через `ARBIBOT_DEV_ROLE` (только `NODE_ENV !== 'production'`).

## Test Commands
```bash
# Проверка, что ADR создан
test -f docs/adr-operator-auth.md
```

## Rollback
`rm docs/adr-operator-auth.md` (ADR-only, код не трогает)
