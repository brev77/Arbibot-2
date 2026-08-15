# Drill #3 — Disaster recovery (DB backup + restore)

> **Step:** `P7-5-DRILL-DR` ([`.cursor/plans/DEVELOPMENT_PLAN7.md`](../.cursor/plans/DEVELOPMENT_PLAN7.md))
> **Depends on:** `P7-2` (backup-automation) — drill exercises the same backup path.
> **Simulator:** `tools/drill-3-disaster-recovery.mjs` (`npm run drill:3`)
> **DR plan:** [`docs/disaster-recovery-plan.md`](disaster-recovery-plan.md)

Репетирует полную DR-процедуру: backup source → drop+recreate test-БД → restore
→ verify migrations → row-count smoke → измерение RTO/RPO.

## ⚠️ Безопасность

Drill работает **только с отдельной test-БД** (`DRILL_TEST_DATABASE_URL`). Он:

- **читает** из source `DATABASE_URL` (pg_dump) — никогда не пишет/не удаляет;
- **drop+recreate+restore** только в test-БД;
- **SAFETY ABORT**: если source и target имеют одинаковое `dbname` — drill падает
  с ошибкой, чтобы исключить случайный drop production-БД.

Не запускайте drill без явного `DRILL_TEST_DATABASE_URL` на production-кластере,
если не уверены, что derived-URL (`<dbname>_drill`) указывает на отдельную БД.

## Когда запускать

- **Перед live** (триггер в [`docs/TODO.md`](TODO.md) Drills).
- После изменений в backup/restore flow (`tools/backup-postgres.sh`, P7-2).
- Регулярно (раз в месяц) — backup, который никогда не восстанавливали = нет backup'а.

## Критерии успеха (DoD)

- **Auto:** backup создаёт dump → test-БД drop+recreate+restore → все миграции
  применились → row-count smoke проходит → cleanup.
- **RTO:** измеренное время backup + restore (заявленное 4h в DR-plan; drill
  показывает ФАКТИЧЕСКОЕ на данном стенде).
- **RPO:** ≈ backup interval (заявленное 24h для daily backup; drill показывает,
  что restore консистентен с последним dump'ом).

## Prerequisites

```bash
# 1. Source DB доступен (production/staging — только чтение через pg_dump).
# 2. На том же Postgres-кластере создайте (или позвольте drill создать) test-БД:
#    drill создаст '<dbname>_drill' автоматически, если есть CREATE DATABASE права.
# 3. tools/backup-postgres.sh и tools/verify-migrations-applied.mjs на месте.

# Явно задайте test-БД (РЕКОМЕНДУЕТСЯ во избежание ambiguities):
export DATABASE_URL="postgres://arbibot:PASS@HOST:5432/arbibot"
export DRILL_TEST_DATABASE_URL="postgres://arbibot:PASS@HOST:5432/arbibot_drill"
```

## Запуск drill'а

```bash
# Полный прогон: backup → drop+recreate+restore → verify → smoke → cleanup
npm run drill:3

# Сухой прогон (только preflight + safety checks, без backup/restore/drop)
DRILL_DRY_RUN=true npm run drill:3

# Оставить test-БД для ручной проверки (например, поднять paper-trading против неё)
DRILL_KEEP_TEST_DB=true npm run drill:3
# Manual cleanup после:
#   psql "postgres://arbibot:PASS@HOST:5432/postgres" -c 'DROP DATABASE IF EXISTS arbibot_drill;'
```

**Env:**

| Переменная | Default | Назначение |
|------------|---------|-----------|
| `DATABASE_URL` | (required) | source DB — pg_dump читает отсюда |
| `DRILL_TEST_DATABASE_URL` | derived `<source>_drill` | target test DB (drop+recreate+restore) |
| `BACKUP_DIR` | `./backups-drill` | temp dump dir |
| `DRILL_KEEP_TEST_DB` | `false` | не drop test-БД после |
| `DRILL_DRY_RUN` | `false` | только preflight |

## Что drill проверяет (по шагам)

1. **Preflight + safety** — source доступен; source ≠ target (по dbname); target host доступен.
2. **Backup** — `tools/backup-postgres.sh backup` (source) → dump file; измеряет backup time.
3. **Restore** — `DROP IF EXISTS` + `CREATE` test-БД; `backup-postgres.sh restore <file> --force` (target); измеряет restore time.
4. **Verify migrations** — `verify-migrations-applied.mjs --all` (target) — все миграции в dump'е.
5. **Row-count smoke** — count в `schema_migrations`, `reconciliation_mismatches`, `execution_plans`, `paper_trades`.
6. **Cleanup** — drop test-БД (если не `DRILL_KEEP_TEST_DB`).

## RTO/RPO

Drill измеряет **фактическое** время backup + restore. Заявленные в
[`docs/disaster-recovery-plan.md`](disaster-recovery-plan.md):

- **RTO:** 4 часа (drill покажет секунды/минуты на данном стенде).
- **RPO:** 24 часа (daily backup; drill подтверждает, что restore консистентен).

Записать измеренные значения в [`docs/TODO.md`](TODO.md) Drills-таблицу (строка
«Disaster recovery») и обновить DR-plan, если фактическое RTO сильно отличается
от заявленного.

## Что drill НЕ покрывает

- **PITR / WAL archiving** — drill использует `pg_dump` (logical dump). Point-in-time
  recovery через WAL — отдельная задача (не в P7-2 scope).
- **paper-trading-service runtime smoke** — drill верифицирует данные, а не сервис.
  Для полного smoke: `DRILL_KEEP_TEST_DB=true npm run drill:3`, затем поднять
  `paper-trading-service` против test-БД (`PAPER_API_BASE` / `DATABASE_URL` → test).
- **Cross-cluster restore** — drill restore на тот же кластер (test-БД). Восстановление
  на другой host — ручная процедура (см. DR-plan §3).

## Troubleshooting

- **`SAFETY ABORT: source and target have the SAME dbname`** — задайте
  `DRILL_TEST_DATABASE_URL` явно, отличное от `DATABASE_URL` dbname.
- **`permission denied for database postgres`** (на CREATE/DROP) — пользователь в
  `DATABASE_URL` должен иметь `CREATEDB` привилегию на кластере.
- **`verify-migrations exited non-zero`** — dump мог быть сделан из БД с меньшим
  числом миграций, чем ожидает `--all`. Проверь, что source применены все 001–057.
- **Restore упал на FK / duplicate** — `pg_dump --clean --if-exists` должен это
  предотвращать; если нет, проверь версию `pg_dump` (должна быть ≥ source Postgres).
