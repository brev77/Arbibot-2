#!/usr/bin/env node
/**
 * Applies infra/postgres/migrations/*.sql in lexical order, each file once.
 * Records applied files in table schema_migrations (P1-1.1-PG).
 *
 * Usage: DATABASE_URL=postgres://... node tools/db-migrate.mjs
 *
 * If the database already had 001 applied before this tracker existed, run once:
 *   psql "$DATABASE_URL" -f infra/postgres/bootstrap-schema-migrations.sql
 * then re-run this script (it will apply only pending *.sql files).
 */
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const migrationsDir = path.join(root, 'infra', 'postgres', 'migrations');

const url = process.env.DATABASE_URL;
if (!url || url.length === 0) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}

const client = new pg.Client({ connectionString: url });
await client.connect();

const ensureTracker = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  filename TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
`;

try {
  await client.query(ensureTracker);

  const files = (await readdir(migrationsDir))
    .filter((f) => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    const check = await client.query(
      'SELECT 1 AS ok FROM schema_migrations WHERE filename = $1',
      [file],
    );
    if (check.rows.length > 0) {
      console.log('Skip (already applied):', file);
      continue;
    }

    const sql = await readFile(path.join(migrationsDir, file), 'utf8');
    console.log('Applying', file);
    await client.query('BEGIN');
    try {
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [
        file,
      ]);
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    }
  }

  console.log('Migrations up to date.');
} finally {
  await client.end();
}
