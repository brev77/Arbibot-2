# D4-C-0-DAY2-ADR — ADR: structured logging (Pino) + release versioning

| Поле | Значение |
|------|----------|
| **depends_on** | `D4-B-8-TWO-PERSON` |
| **risk_level** | `medium` |
| **estimated_hours** | 2 |
| **status** | `planned` |

## Контекст (из ревью)
- Нет structured JSON logging (Pino/winston/nestjs-pino отсутствуют). `packages/nest-platform/src/structured-logger.ts` только prepend'ит `[correlationId=...]` к text. Loki глотает plain text. Признано в `docs/observability-baseline.md` (P4).
- Нет версионирования релизов: нет `CHANGELOG.md`, нет git-тегов, нет `version` в `package.json`. Образы по SHA (P5).

## Outputs
- `docs/adr-observability-logging-release.md`:
  - **Logging:** выбор `nestjs-pino` (Nest-native, JSON, low-overhead) vs winston. pino HTTP middleware для correlation-id propagation. Loki уже в стеке — JSON parsing в Promtail pipeline.
  - **Versioning:** решение — conventional-commits + standard-version/semantic-release ИЛИ ручной CHANGELOG + git tags `v<major>.<minor>.<patch>`. Для paper-deploy достаточно ручного + tags.

## Decision criteria
- Structured logging не должен ломать существующий `withCorrelation()`
- Versioning не должен требовать сложной инфраструктуры (paper-deploy)
- Promtail pipeline stages для JSON parse

## Edge Cases
- Миграция существующих `Logger.log()` вызовов → pino adapter с тем же API (минимум churn)
- Sensitive fields в logs → pino redact plugin (wallet keys, mnemonics — K1.1)
- Tags vs releases на private repo → GHCR tags уже есть, добавить git tags для traceability

## Test Commands
```bash
test -f docs/adr-observability-logging-release.md
```

## Rollback
`rm docs/adr-observability-logging-release.md`
