#!/usr/bin/env node
/**
 * Verifies schema_migrations contains expected filenames (default: 030 + 031).
 * Usage: DATABASE_URL=... node tools/verify-migrations-applied.mjs [file.sql ...]
 */
import pg from 'pg';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}

const defaultRequired = [
  '030_paper_promotion_quality_fields.sql',
  '031_portfolio_position_close_idempotency.sql',
];
const required =
  process.argv.length > 2 ? process.argv.slice(2) : defaultRequired;

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
  console.log('OK: all required migrations applied:', required.join(', '));
} finally {
  await client.end();
}
