# 03 — Локальная разработка

Краткая выжимка; полные команды и таблица портов — в [README.md](../../README.md) и [AGENTS.md](../../AGENTS.md).

## Требования

- **Node.js** ≥ 22, **npm** 11+ (см. корневой `package.json`).
- **PostgreSQL**, **Redis** — проще всего через Docker Compose.
- **Docker Compose** — файл [infra/docker-compose.dev.yml](../../infra/docker-compose.dev.yml). Опционально профиль `bus` (Redpanda/Kafka).

## Минимальный порядок действий

1. `npm ci` в корне репозитория.
2. Скопировать [`.env.example`](../../.env.example) → **`.env`** в корне (файл в `.gitignore`, в Git не коммитить).
3. Задать рабочий `DATABASE_URL` (в dev по умолчанию хост **127.0.0.1:15432** — см. комментарии в `.env.example`, чтобы не пересечься с локальным Postgres на 5432).
4. `docker compose -f infra/docker-compose.dev.yml up -d` (и при необходимости `--profile bus`).
5. `npm run db:migrate` — SQL-миграции в [infra/postgres/migrations](../../infra/postgres/migrations/). Нюансы учёта миграций — [infra/postgres/README.md](../../infra/postgres/README.md).
6. `npm run lint`, `npm run build`, `npm run test` — как в CI.

## Канонический справочник (важно)

После миграций таблицы `venue_refs`, `canonical_instruments`, `canonical_routes` **не заполняются автоматически**. Без ручной загрузки данных эндпоинты `resolve-instrument` / `resolve-route` будут отвечать 404. См. *Seed note* в [README.md](../../README.md).

## Порты и конфликты

Несколько процессов на одной машине: по умолчанию **risk** и **Next dev** могут претендовать на **3000** — задайте разные `PORT` или `next dev -p …`. Таблица портов — в README.

## Windows

Если путь к клону содержит **пробелы**, `nest build` / watch может не положить `dist/main.js` — рекомендации в [AGENTS.md](../../AGENTS.md) (клон без пробелов или `subst`).

## Секреты и политики при локальной работе

См. [07 — секреты, настройка, мониторинг](07-secrets-config-and-monitoring.md).

Дальше: [04 — тестирование и CI](04-testing-and-ci.md).
