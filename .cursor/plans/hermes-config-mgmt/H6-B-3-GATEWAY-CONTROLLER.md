# H6-B-3-GATEWAY-CONTROLLER — controller + service + module + http-error

| Поле | Значение |
|------|----------|
| **depends_on** | `H6-B-2-GATEWAY-DTOS` |
| **risk_level** | `medium` |
| **status** | done |

## Outputs
- `apps/hermes-gateway/src/hermes/http-error.ts` — общий `asExceptionBody` (вынесен из дублей).
- `apps/hermes-gateway/src/hermes/hermes-config.service.ts` — update/rollback/promote/activate + audit (`HERMES_CONFIG_*_OK/_HTTP_<n>`, resourceType `policy_configuration`).
- `apps/hermes-gateway/src/hermes/hermes-config.controller.ts` — `HermesConfigReadController` (GET, `HermesAuthGuard`) + `HermesConfigMutationController` (PUT/POST/PATCH, `+HermesMutationRateLimitGuard`).
- `hermes.module.ts` — регистрация обоих контроллеров + `HermesConfigService`.

## Маршруты
- GET `/config`, `/config/:key`, `/config/:key/effective`, `/config/:key/history`.
- PUT `/config/:key`, POST `/config/:key/rollback`, POST `/config/:key/promote`, PATCH `/config/:key/status`.
- Каждая mutation: `assertConfigKeyAllowed` → upstream (`signedFetch` в проде) → audit.

## Test
- `hermes-config.service.spec.ts`: allowlist блокирует risk/execution/capital (403, без upstream-вызова); safe-ключи идут на правильный URL с operatorId+approveReason; audit action naming.
- 10 suites / 135 тестов проходят.
