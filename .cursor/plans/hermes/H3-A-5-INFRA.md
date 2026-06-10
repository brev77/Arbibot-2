# H3-A-5-INFRA — Обновление env/infrastructure

| Поле | Значение |
|------|----------|
| **depends_on** | `H3-A-3-BACKEND`, `H3-A-4-FRONTEND` |
| **risk_level** | `medium` |
| **estimated_hours** | 1 |
| **status** | planned |

## Outputs
Обновлённые конфигурационные файлы

## Файлы (~9)
- `.env.example` — все `HERMES_*` → `HERMES_*` (~17 строк)
- `infra/docker-compose.prod.yml` — сервис, образ, env vars (строки 324-342, 363)
- `infra/docker-compose.dev.yml` — если содержит упоминания
- `infra/prometheus/prometheus.yml` — scrape target
- `tools/docker-build-all.sh` — workspace, entry point (строка 45)
- `tools/validate-env.sh` — env var проверки
- `tools/verify-deployment.sh` — health check URL
- `package.json` (root) — `"dev:HERMES"` → `"dev:hermes"`, workspace ref
- `.github/workflows/ci.yml` — проверить env vars

## Edge Cases
- `package-lock.json` — обновить через `npm ci`
- Docker image tags — обновить registry references

## Test Commands
```bash
npm ci
npm run build
```

## Rollback
`git checkout -- .env.example infra/ tools/ package.json`