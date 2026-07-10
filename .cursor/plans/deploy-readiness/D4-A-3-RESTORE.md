# D4-A-3-RESTORE — Починка процедуры restore (backup)

| Поле | Значение |
|------|----------|
| **depends_on** | — |
| **risk_level** | `high` |
| **estimated_hours** | 3 |
| **status** | `planned` |

## Контекст (из ревью)
- `docs/deployment-guide.md:648` и `docs/deployment-checklist.md:138` учат: `bash tools/backup-postgres.sh restore /path/to/backup.sql` — **но у скрипта нет restore-аргумента** (P3).
- `docs/disaster-recovery-plan.md:172` ссылается на `infra/postgres/migrations/rollback/036_rollback.sql` — **каталог/файл не существуют**.
- Бэкап (`pg_dump` + 30-дн ротация; S3 upload закомментирован) делается; restore — нет. `db:restore` npm-скрипта нет.

## Outputs
- `tools/backup-postgres.sh` — добавить `restore`-сабкоманду: `backup-postgres.sh restore <file>`
  - Восстановление: `gunzip -c <file> | psql "$DATABASE_URL"` (или `pg_restore` для custom-format)
  - Confirm-prompt перед destructive restore
  - Запрет restore на тот же `DATABASE_URL` без `--force` (защита от случайного затирания)
- `package.json` — `db:restore` скрипт: `bash tools/backup-postgres.sh restore`
- `docs/deployment-guide.md` + `docs/deployment-checklist.md` + `docs/disaster-recovery-plan.md` — убрать мёртвые ссылки на `migrations/rollback/`, обновить процедуру restore на новую сабкоманду
- (Опц.) `tools/verify-backup.sh` — выкачать свежий бэкап, восстановить во временную БД, прогнать `db:verify-migrations:all`

## Acceptance
- [ ] `bash tools/backup-postgres.sh restore <dump>` восстанавливает БД (проверено на dev-стеке)
- [ ] `npm run db:restore` работает
- [ ] Документы не содержат ссылок на несуществующий `migrations/rollback/`
- [ ] DR-план описывает реальную процедуру restore, протестированную хотя бы на dev

## Edge Cases
- Восстановление в БД с уже применёнными миграциями — `pg_dump --clean --if-exists` для drop-before-create
- Cross-major Postgres (16 → другое) — явно указать совместимость в runbook

## Test Commands
```bash
# На dev-стеке: сделать бэкап, дропнуть тестовую схему, восстановить, проверить
npm run db:backup
npm run db:restore -- $(ls -t backups/*.sql.gz | head -1)
npm run db:verify-migrations:all
```

## Rollback
`git checkout -- tools/backup-postgres.sh package.json docs/deployment-guide.md docs/deployment-checklist.md docs/disaster-recovery-plan.md`
