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

// Pre-flight: read migration files and run the collision guard BEFORE
// connecting to the database. This way a version-prefix collision fails fast
// without needing a reachable DB (D4-A-4-MIGRATIONS).
const files = (await readdir(migrationsDir))
  .filter((f) => f.endsWith('.sql'))
  .sort();

// Collision guard (D4-A-4-MIGRATIONS): detect two files sharing the same
// numeric prefix (e.g. 037_a.sql and 037_b.sql). Such a collision makes the
// apply order depend on the full filename rather than the version number,
// which is non-deterministic from a migration-versioning perspective.
const prefixCounts = new Map();
for (const f of files) {
  const prefix = f.slice(0, 3); // e.g. "037"
  prefixCounts.set(prefix, (prefixCounts.get(prefix) ?? 0) + 1);
}
const collisions = [...prefixCounts.entries()].filter(
  ([, count]) => count > 1,
);
if (collisions.length > 0) {
  console.error(
    'ERROR: migration version collision detected (same 3-digit prefix):',
  );
  for (const [prefix, count] of collisions) {
    const dupes = files.filter((f) => f.slice(0, 3) === prefix);
    console.error(`  ${prefix}: ${count} files → ${dupes.join(', ')}`);
  }
  console.error(
    'Rename one of the files to the next free number. Aborting to avoid non-deterministic apply order.',
  );
  process.exit(1);
}

await client.connect();

const ensureTracker = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  filename TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
`;

try {
  await client.query(ensureTracker);

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
