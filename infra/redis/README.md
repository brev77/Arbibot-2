# Redis (Phase 1.1-REDIS)

## Dev

Поднять вместе с Postgres: `docker compose -f infra/docker-compose.dev.yml up -d`.

Переменная: `REDIS_URL` (например `redis://127.0.0.1:6379`). Если не задана, сервисы работают без Redis.

## Клиент

Фабрика `createRedisClientFromEnv()` в пакете `@arbibot/nest-database` — подключается при наличии `REDIS_URL`, иначе возвращает `null`.

## Политика ключей (черновик)

- Префикс пространства имён: `arb:{service}:{aggregate}:` (например `arb:risk:window:`).
- TTL для эфемерных ключей явно задаётся при `SET`; источник истины для резервов остаётся PostgreSQL.
- Координация (locks, rate limits) — только поверх уже зафиксированных в БД правил; Redis не источник истины для капитала/риска.
