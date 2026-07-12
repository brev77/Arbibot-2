# D4-A-5-PROBES — /ready vs /live probes + readiness health endpoints

| Поле | Значение |
|------|----------|
| **depends_on** | — |
| **risk_level** | `low` |
| **estimated_hours** | 3 |
| **status** | `done` |

## Контекст (из ревью)
HEALTHCHECK `Dockerfile.nest` и k8s-пробы бьют в `/metrics` — доказывает, что процесс жив, но **не что готов обслуживать** (нет проверки DB/Redis/Kafka). Отдельный `/health` есть только на `hermes-gateway` и `apps/web` (`/api/health`); на остальных 11 сервисах его нет (P8).

## Outputs
- `packages/nest-platform/src/health/` — переиспользуемый `HealthController`:
  - `GET /health/live` → `{ ok: true }` (process up; без зависимостей) — для livenessProbe
  - `GET /health/ready` → проверяет критичные зависимости (DB ping, Redis ping, optional Kafka) → `{ ok, checks: {...} }` — для readinessProbe
- Подключить в каждом из 11 сервисов (через `NestPlatformModule` или экспорт-импорт)
- `infra/docker/Dockerfile.nest` HEALTHCHECK → `/health/live`
- `infra/docker-compose.prod.yml` — `healthcheck` → `/health/ready` где есть зависимости (DB), `/health/live` для stateless
- `docs/deployment-guide.md` — обновить таблицу probes

## Acceptance
- [ ] Каждый Nest-сервис отдаёт `/health/live` (200 всегда) и `/health/ready` (200 если DB/Redis reachable)
- [ ] `/health/ready` возвращает 503 при недоступной БД (проверка: `docker stop postgres` → /ready падает)
- [ ] Docker HEALTHCHECK использует `/health/live`, не `/metrics`
- [ ] compose-prod readiness-цепочки (`depends_on: service_healthy`) корректно ждут готовности зависимостей

## Edge Cases
- DB-ping в /ready не должен быть тяжёлым (`SELECT 1`, не миграции)
- Таймаут проверок < 2s, чтобы не блокировать старт
- `/metrics` остаётся для Prometheus scraping (не убирать)

## Test Commands
```bash
npm run build -w @arbibot/nest-platform
# Поднять сервис, проверить
curl http://localhost:3010/health/live   # opportunity
curl http://localhost:3010/health/ready  # должен зависеть от DB
```

## Rollback
`git checkout -- packages/nest-platform/src/ infra/docker/Dockerfile.nest infra/docker-compose.prod.yml`
