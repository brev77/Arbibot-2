# D4-B-6-MTLS — Enforce service-to-service auth (mTLS или HMAC)

| Поле | Значение |
|------|----------|
| **depends_on** | `D4-B-0-LIVE-ADR` |
| **risk_level** | `high` |
| **estimated_hours** | 5 |
| **status** | `done` |

## Контекст (из ревью)
`ServiceAuthModule` (HMAC, `packages/nest-platform/src/service-auth/fastify-guard.ts`) есть, но opt-in через `ARBIBOT_SERVICE_AUTH_ENABLED=true`. В `.env.production.example` **выключен**. Любой контейнер в сети `arbibot-backend` может вызывать любой сервис без auth. Finding **F1 (🔴)** в `docs/pre-deploy-review.md`. `tools/generate-internal-certs.sh` (12 service certs для mTLS) существует, но не enforced (L6).

## Outputs
- ADR-решение: **HMAC ServiceAuth** (проще, есть) **или mTLS** (надёжнее, certs готовы). Рекомендация для live: mTLS.
- Если mTLS:
  - Сгенерировать internal CA + 12 service certs (`tools/generate-internal-certs.sh` уже есть)
  - Fastify https options в `packages/nest-platform/src/http-server.ts` (или аналог) — читать certs из env/mount
  - Включить в `docker-compose.prod.yml` для backend-сервсовов (mount certs, `ARBIBOT_INTERNAL_TLS=true`)
  - `ServiceAuthModule` как fallback для не-mTLS caller'ов
- Если HMAC (минимум):
  - `ARBIBOT_SERVICE_AUTH_ENABLED=true` в `.env.production.example`
  - `ARBIBOT_SERVICE_AUTH_SECRET` (≥32 байт) на месте
  - Все service-to-service клиенты подписывают запросы (проверить `@arbibot/nest-platform` service-auth client-side)
- `tools/validate-env.sh` — блокировать prod-deploy если auth выключен (extension)
- `docs/security-hardening-guide.md` — отметить C-1 mTLS как `[x]`

## Acceptance
- [x] В prod все backend-services требуют auth от caller'ов — все 12 backend `main.ts` используют `createServiceAuthPreHandler`/`applyArbibotHttpSecurity`; `.env.production.example:121` `ARBIBOT_SERVICE_AUTH_ENABLED=true` (HMAC ServiceAuth-путь)
- [x] Запрос без подписи/cert → 401/503 (fail-closed уже есть в guard) — `packages/nest-platform/src/service-auth/fastify-guard.ts:116-132`
- [ ] `tools/validate-env.sh` блокирует prod-deploy без auth-config — частично: при `ARBIBOT_SERVICE_AUTH_ENABLED != 'true'` скрипт вызывает `log_warn` (`validate-env.sh:308-321`), НЕ `log_fail`; нужен hardened-режим
- [x] Юнит/интеграционный тест: запрос без auth отклонён — `fastify-guard.spec.ts` (6), `signature.spec.ts` (28), `fetch-signer.spec.ts` (10)

## Edge Cases
- web BFF → backend: должен подписывать/иметь cert (единый mechanism для всех caller'ов)
- hermes-gateway → upstream: то же
- Health-check probes (`/health/live`, `/metrics`) — exempt от auth (read-only, не sensitive)
- Rotate secret/cert — задокументировать процедуру

## Test Commands
```bash
npm run test -w @arbibot/nest-platform
npm run verify:env   # должен блокировать без auth
```

## Rollback
`git checkout -- packages/nest-platform/src/service-auth/ .env.production.example tools/validate-env.sh docs/security-hardening-guide.md`
