#!/usr/bin/env node
/**
 * Offline export of route_scoring_history for P4-4-SCORE replay prep (no ClickHouse).
 *
 * Usage:
 *   DATABASE_URL=... node tools/export-route-scoring-history.mjs
 *   DATABASE_URL=... ROUTE_KEY=my-route LOOKBACK_HOURS=168 FORMAT=jsonl node tools/export-route-scoring-history.mjs
 *
 * Writes to stdout (redirect to file). FORMAT: jsonl | csv (default jsonl).
 */

import pg from 'pg';

const DATABASE_URL = process.env.DATABASE_URL;
const ROUTE_KEY = process.env.ROUTE_KEY?.trim();
const LOOKBACK_HOURS = Math.max(
  1,
  Number.parseInt(process.env.LOOKBACK_HOURS ?? '168', 10) || 168,
);
const FORMAT = (process.env.FORMAT ?? 'jsonl').toLowerCase();
const LIMIT = Math.min(
  500_000,
  Math.max(1, Number.parseInt(process.env.LIMIT ?? '50000', 10) || 50_000),
);

function csvEscape(s) {
  const t = String(s);
  if (/[",\n\r]/.test(t)) {
    return `"${t.replace(/"/g, '""')}"`;
  }
  return t;
}

async function main() {
  if (!DATABASE_URL) {
    throw new Error('DATABASE_URL is required');
  }

  const client = new pg.Client({ connectionString: DATABASE_URL });
  await client.connect();
  try {
    const params = [`${LOOKBACK_HOURS} hours`];
    let sql = `
      SELECT id::text AS id,
             route_key AS route_key,
             score::text AS score,
             model_version AS model_version,
             recorded_at AS recorded_at
      FROM route_scoring_history
      WHERE recorded_at >= NOW() - ($1::text)::interval`;
    if (ROUTE_KEY) {
      sql += ` AND route_key = $2`;
      params.push(ROUTE_KEY);
    }
    sql += ` ORDER BY recorded_at ASC LIMIT ${LIMIT}`;

    const res = await client.query(sql, params);

    if (FORMAT === 'csv') {
      console.log('id,route_key,score,model_version,recorded_at_iso');
      for (const row of res.rows) {
        console.log(
          [
            csvEscape(row.id),
            csvEscape(row.route_key),
            csvEscape(row.score),
            csvEscape(row.model_version),
            csvEscape(new Date(row.recorded_at).toISOString()),
          ].join(','),
        );
      }
    } else {
      for (const row of res.rows) {
        console.log(
          JSON.stringify({
            id: row.id,
            routeKey: row.route_key,
            score: row.score,
            modelVersion: row.model_version,
            recordedAtIso: new Date(row.recorded_at).toISOString(),
          }),
        );
      }
    }
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
