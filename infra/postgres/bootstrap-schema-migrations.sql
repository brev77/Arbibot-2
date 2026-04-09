-- Run once if `001_core.sql` was applied before `schema_migrations` tracking existed.
-- Then: npm run db:migrate (or node tools/db-migrate.mjs with DATABASE_URL).
--
--   psql "$DATABASE_URL" -f infra/postgres/bootstrap-schema-migrations.sql

CREATE TABLE IF NOT EXISTS schema_migrations (
  filename TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO schema_migrations (filename)
VALUES ('001_core.sql')
ON CONFLICT (filename) DO NOTHING;
