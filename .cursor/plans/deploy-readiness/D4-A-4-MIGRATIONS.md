# D4-A-4-MIGRATIONS — Коллизия 037 + процедура применения миграций в prod

| Поле | Значение |
|------|----------|
| **depends_on** | — |
| **risk_level** | `medium` |
| **estimated_hours** | 3 |
| **status** | `done` |

## Контекст (из ревью)
- Коллизия версий: `infra/postgres/migrations/037_alertmanager_incidents.sql` и `037_fix_get_effective_config_value.sql` — недетерминированный порядок применения (`tools/db-migrate.mjs` применяет в лексическом порядке) (P7).
- `cd.yml` только build+push; нет init-контейнера, хука в `infra/docker/entrypoint.nest.sh` (только `exec node "${ENTRY}"`), или шага CD для `db:migrate`. Оператор вручную гоняет миграции.

## Outputs
1. **Ренумерация коллизии:** один из `037_*` → `038_*` (выбрать по дате/логике: `037_fix_get_effective_config_value.sql` скорее всего старше → оставить; `037_alertmanager_incidents.sql` → `038_alertmanager_incidents.sql`). Проверить, что `schema_migrations` уже содержит применённые — переименование требует записи в трекере (переменовать И обновить строку в `schema_migrations` на dev-стеках).
2. **Процедура prod-применения** — документ в `docs/deployment-guide.md §7`:
   - Порядок: migrate-**до** rollout новых образов (forward-compatible миграции)
   - Проверка: `npm run db:verify-migrations:all` перед и после
   - Rollback-стратегия (forward-only): «откат = восстановление из бэкапа + образ предыдущего SHA» (см. D4-A-3)
3. **(Опц.) Автоматизация** — init-контейнер в `infra/docker-compose.prod.yml` или pre-deploy hook в `cd.yml`, запускающий `db:migrate` перед стартом сервисов. Решить в ADR: init-контейнер vs ручное (для paper — ручное допустимо).

## Acceptance
- [x] Нет двух файлов с одинаковым числовым префиксом в `infra/postgres/migrations/` — 43 файла `001`–`043`, дубликатов нет (коллизия `037`/`038` разрешена)
- [ ] `npm run db:migrate` на чистой БД применяет все миграции детерминированно — операционная проверка на чистой БД pending (ordering hazard устранён)
- [x] `docs/deployment-guide.md` описывает порядок migrate→rollout + rollback-процедуру — `:417-419,457-463`
- [x] (Если init-контейнер) compose-prod запускает миграции автоматически перед сервисами — n/a: план помечал "(Опц.)"; для paper-deploy допустимо ручное `db:migrate`

## Edge Cases
- Уже применённые среды: переименование `037` → `038` требует `UPDATE schema_migrations SET filename='038_...' WHERE filename='037_...'` на каждой среде (документировать!)
- Forward-compatibility: миграция не должна ломать работающие старые образы (additive-only preferred)

## Test Commands
```bash
# На чистой dev-БД
docker compose -f infra/docker-compose.dev.yml down -v
docker compose -f infra/docker-compose.dev.yml up -d postgres
npm run db:migrate
npm run db:verify-migrations:all
```

## Rollback
`git checkout -- infra/postgres/migrations/` + вернуть строки в `docs/deployment-guide.md`
