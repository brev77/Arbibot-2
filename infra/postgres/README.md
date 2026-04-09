# PostgreSQL (dev)

1. Создайте БД и пользователя (локально или Docker).
2. Примените миграции из корня репозитория:

```bash
# PowerShell
$env:DATABASE_URL = "postgres://USER:PASS@127.0.0.1:5432/DBNAME"
npm run db:migrate
```

Скрипт [`tools/db-migrate.mjs`](../../tools/db-migrate.mjs) создаёт таблицу `schema_migrations` и выполняет каждый файл из `infra/postgres/migrations/*.sql` **один раз** (в лексикографическом порядке).

Если ядро (`001_core.sql`) уже накатывали вручную до появления учёта миграций, один раз зафиксируйте это и затем снова запустите `db:migrate` (подтянется только `002_*.sql` и следующие):

```bash
psql "$DATABASE_URL" -f infra/postgres/bootstrap-schema-migrations.sql
npm run db:migrate
```

Переменная окружения: `DATABASE_URL` (например `postgres://arbibot:arbibot@localhost:5432/arbibot` — как в [`.env.example`](../../.env.example)).
