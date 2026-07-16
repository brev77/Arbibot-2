# D4-C-1-LOGGING — Structured JSON logging (nestjs-pino)

| Поле | Значение |
|------|----------|
| **depends_on** | `D4-B-0-LIVE-ADR`, `D4-C-0-DAY2-ADR` |
| **risk_level** | `medium` |
| **estimated_hours** | 6 |
| **status** | `done` |

## Контекст (из ревью)
Нет structured logging. `packages/nest-platform/src/structured-logger.ts` — text + correlation prefix. Loki + Promtail есть в стеке, но глотают неструктурированный текст (P4).

## Outputs
1. **`packages/nest-platform/src/logging/`** — pino wrapper:
   - `nestjs-pino` интеграция (модуль, переопределяющий Nest `Logger`)
   - JSON transport: `{ timestamp, level, service, correlationId, msg, ...meta }`
   - `pino-http` для HTTP request/response logging с correlation-id propagation
   - `redact` paths: `privateKey`, `mnemonic`, `*.secret`, `authorization` (K1.1)
2. **Promtail pipeline** (`infra/promtail/promtail-config.yml`):
   - `json` stage для parse, `labels` для `service`/`level`
   - Loki query examples в `infra/grafana/README.md`
3. **Обновить `withCorrelation()`** — делегировать к pino child logger (сохранить API)
4. Подключить во всех 12 сервисах (через `NestPlatformModule`)
5. `docs/observability-tracing.md` — обновить секцию logging (JSON examples, Loki queries)

## Acceptance
- [x] Все сервисы логируют в JSON (`PinoLoggerService` подключён во всех 12 `main.ts` через `configureArbibotLogger`; формат NDJSON `{level,time,service,correlationId,context,msg,...}`)
- [x] `correlationId` propagated через ALS (существующий `correlationIdPreHandler` — pino mixin читает `getCorrelationId()`, без новой middleware)
- [x] Sensitive fields redacted (`ARBIBOT_LOG_REDACT_PATHS`: privateKey/mnemonic/signingKey/secret/apiKey/authorization + req.headers.* — тесты K1.1/K1.2 green)
- [x] Promtail парсит JSON, Loki показывает поля как labels (`infra/promtail/promtail-config.yaml` — json stage level/msg/service/correlationId/time + labels stage)
- [x] Существующий `withCorrelation()` API сохранён (thin shim, 0 callers сегодня)
- [x] 13 unit-тестов в `pino-logger.service.spec.ts` (формат, уровни, контекст, redact, LOG_LEVEL, correlationId); build 22/22 ✅, lint clean

## Implementation notes
- `packages/nest-platform/src/logging/` — `pino-logger.service.ts` (Nest `LoggerService` over pino), `configure-arbibot-logger.ts` (helper для main.ts), `redact.config.ts` (K1.1/K1.2 paths)
- `pino` добавлен как direct dep в `@arbibot/nest-platform` (раньше transitive от fastify)
- ISO-8601 timestamp (не epoch-millis) для Promtail RFC3339 + человекочитаемости
- Pretty-print auto-on вне production; override через `ARBIBOT_LOG_PRETTY=true`
- `LOG_LEVEL` env (default info)
- Version promtail выровнен dev (3.2.1) → prod (3.3.2) — убран drift
- `docs/observability-tracing.md` — секция «Structured logging» с line format, env table, Loki queries
- `.env.example` — `LOG_LEVEL`, `ARBIBOT_LOG_PRETTY`

## Edge Cases
- Nest bootstrap logs (до pino init) → buffer + flush после setup
- Error stack traces → pino сериализует корректно
- Log level по env (`LOG_LEVEL=debug|info|warn|error`)
- Redact deep paths (`req.headers.authorization`)

## Test Commands
```bash
npm run build -w @arbibot/nest-platform
npm run test -w @arbibot/nest-platform
# Dev-стек: проверить формат
docker compose -f infra/docker-compose.dev.yml --profile observability up -d
docker logs arbibot-risk-service 2>&1 | head -5  # должен быть JSON
```

## Rollback
`git checkout -- packages/nest-platform/src/structured-logger.ts infra/promtail/ docs/observability-tracing.md` + удалить `packages/nest-platform/src/logging/`
