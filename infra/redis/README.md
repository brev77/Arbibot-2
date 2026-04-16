# Redis (Phase 1.1-REDIS)

## Dev

Поднять вместе с Postgres: `docker compose -f infra/docker-compose.dev.yml up -d`.

Переменная: `REDIS_URL` (например `redis://127.0.0.1:6379`). Если не задана, сервисы работают без Redis.

## Клиент

Фабрика `createRedisClientFromEnv()` в пакете `@arbibot/nest-database` — подключается при наличии `REDIS_URL`, иначе возвращает `null`.

**Использование в коде (Phase 1):** `canonical-market-service` при наличии `REDIS_URL` кэширует успешные ответы `resolve-instrument` / `resolve-route` (cache-aside, TTL 90s, ключи `arb:canonical:ri:v1:*` / `arb:canonical:rr:v1:*`); при ошибках Redis запросы идут в PostgreSQL как без Redis.

## Политика ключей (черновик)

- Префикс пространства имён: `arb:{service}:{aggregate}:` (например `arb:risk:window:`).
- TTL для эфемерных ключей явно задаётся при `SET`; источник истины для резервов остаётся PostgreSQL.
- Координация (locks, rate limits) — только поверх уже зафиксированных в БД правил; Redis не источник истины для капитала/риска.
