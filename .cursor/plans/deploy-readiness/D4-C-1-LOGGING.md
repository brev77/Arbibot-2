# D4-C-1-LOGGING — Structured JSON logging (nestjs-pino)

| Поле | Значение |
|------|----------|
| **depends_on** | `D4-B-0-LIVE-ADR`, `D4-C-0-DAY2-ADR` |
| **risk_level** | `medium` |
| **estimated_hours** | 6 |
| **status** | `planned` |

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
- [ ] Все сервисы логируют в JSON (проверка: `docker logs <svc>` → валидный JSON per line)
- [ ] `correlationId` propagated через HTTP calls (pino-http middleware)
- [ ] Sensitive fields redacted (тест: залогировать объект с `privateKey` → redacted в output)
- [ ] Promtail парсит JSON, Loki показывает поля как labels
- [ ] Существующий `withCorrelation()` API сохранён (минимум churn в прикладном коде)
- [ ] Perf: pino не добавляет > 5% latency (бенчмарк на dev)

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
