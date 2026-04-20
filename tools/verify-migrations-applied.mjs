#!/usr/bin/env node
/**
 * Verifies schema_migrations contains expected filenames (default: 030 + 031).
 * Usage:
 *   DATABASE_URL=... node tools/verify-migrations-applied.mjs [file.sql ...]
 *   DATABASE_URL=... node tools/verify-migrations-applied.mjs --all
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}

const argv = process.argv.slice(2);
const allFlag = argv.includes('--all');
const fileArgs = argv.filter((a) => a !== '--all');

const migrationsDir = path.join(__dirname, '../infra/postgres/migrations');

const defaultRequired = [
  '030_paper_promotion_quality_fields.sql',
  '031_portfolio_position_close_idempotency.sql',
];

let required;
if (allFlag) {
  required = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  if (required.length === 0) {
    console.error('No .sql files in', migrationsDir);
    process.exit(1);
  }
} else if (fileArgs.length > 0) {
  required = fileArgs;
} else {
  required = defaultRequired;
}

const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  const table = await client.query(
    "SELECT to_regclass('public.schema_migrations') AS reg",
  );
  if (!table.rows[0]?.reg) {
    console.error(
      'Table schema_migrations not found. Run npm run db:migrate (or bootstrap per tools/db-migrate.mjs header).',
    );
    process.exit(1);
  }
  const missing = [];
  for (const filename of required) {
    const r = await client.query(
      'SELECT 1 FROM schema_migrations WHERE filename = $1',
      [filename],
    );
    if (r.rows.length === 0) missing.push(filename);
  }
  if (missing.length > 0) {
    console.error('Missing schema_migrations rows:', missing.join(', '));
    console.error('Run: npm run db:migrate');
    process.exit(1);
  }
  console.log(
    'OK: all required migrations applied:',
    allFlag ? `${required.length} files (full repo set)` : required.join(', '),
  );
} finally {
  await client.end();
}
