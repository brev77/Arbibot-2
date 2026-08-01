#!/usr/bin/env node

/**
 * Drill #3 — Disaster recovery (DB backup + restore)
 *
 * Репетирует полную DR-процедуру: backup production-БД → drop test-БД →
 * restore → verify migrations → row-count smoke → измерение RTO/RPO.
 * Закрывает drill «Перед live» (см. docs/TODO.md Drills) и проверяет P7-2
 * (backup-automation) end-to-end.
 *
 * ⚠️ БЕЗОПАСНОСТЬ: drill работает ТОЛЬКО с отдельной test-БД
 * (DRILL_TEST_DATABASE_URL). Он НЕ трогает DATABASE_URL (source) — только
 * читает из него (pg_dump). Перед любым destructive-шагом drill проверяет,
 * что source и target — разные базы (по host+dbname). Если они совпадают —
 * FAIL с подсказкой задать DRILL_TEST_DATABASE_URL.
 *
 * Что drill делает автоматически:
 *   1. Preflight: source доступен; source ≠ target (safety); target host доступен.
 *   2. Backup: tools/backup-postgres.sh backup (source DATABASE_URL) → dump file.
 *      Измеряет backup time (часть RTO).
 *   3. Restore: drop+recreate target test-БД; restore dump (target) --force.
 *      Измеряет restore time (часть RTO).
 *   4. Verify migrations: verify-migrations-applied.mjs --all (target) — все
 *      миграции применились из dump.
 *   5. Smoke: row count в ключевых таблицах target (schema_migrations,
 *      reconciliation_mismatches, execution_plans) — что данные на месте.
 *   6. Report: RTO (backup+restore), RPO (≈ backup interval, заявленный),
 *      pass/fail по каждому шагу.
 *   7. Cleanup: drop test-БД (если DRILL_KEEP_TEST_DB=false).
 *
 * Что drill НЕ делает:
 *   - Не запускает paper-trading-service smoke (отдельная ручная проверка;
 *     drill верифицирует данные, а не сервис). Оператор может поднять
 *     paper-trading против test-БД вручную для полного smoke.
 *   - Не тестирует PITR/WAL (pg_dump — logical dump; WAL — отдельная задача).
 *
 * Usage:
 *   node tools/drill-3-disaster-recovery.mjs
 *
 * Env:
 *   DATABASE_URL              — source production/staging Postgres (pg_dump source). REQUIRED.
 *   DRILL_TEST_DATABASE_URL   — target test DB (drop+recreate+restore). REQUIRED, MUST differ from DATABASE_URL.
 *                               Default: derived from DATABASE_URL with dbname → '<dbname>_drill'.
 *   BACKUP_DIR                — temp dump dir (default ./backups-drill).
 *   DRILL_KEEP_TEST_DB        — `true`: не drop test-БД после (для ручной проверки, default false).
 *   DRILL_DRY_RUN             — `true`: только preflight + safety checks, без backup/restore.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

const CONFIG = {
  DATABASE_URL: process.env.DATABASE_URL,
  DRILL_TEST_DATABASE_URL: process.env.DRILL_TEST_DATABASE_URL,
  BACKUP_DIR: process.env.BACKUP_DIR || path.resolve('./backups-drill'),
  DRILL_KEEP_TEST_DB: process.env.DRILL_KEEP_TEST_DB === 'true',
  DRILL_DRY_RUN: process.env.DRILL_DRY_RUN === 'true',
};

const COLORS = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  dim: '\x1b[2m',
};

function pad(s, n) {
  return String(s).padEnd(n, ' ');
}
function log(msg, color = COLORS.reset) {
  console.log(`${color}${msg}${COLORS.reset}`);
}
function header(title) {
  log('');
  log(`── ${title} `.padEnd(72, '─'), COLORS.cyan);
}

/** Parse host + dbname out of a postgres:// URL for the safety check. */
function parsePg(url) {
  try {
    const u = new URL(url);
    const dbname = u.pathname.replace(/^\//, '');
    return { host: u.host, dbname };
  } catch {
    return { host: '', dbname: '' };
  }
}

function deriveTestUrl(sourceUrl) {
  // Default: same host/creds, dbname + '_drill'.
  const { dbname } = parsePg(sourceUrl);
  if (!dbname) return null;
  return sourceUrl.replace(/\/[^/]*$/, `/${dbname}_drill`);
}

async function pgAdmin(url, sql) {
  const pgMod = await import('pg');
  const client = new pgMod.Client({ connectionString: url });
  try {
    await client.connect();
    return await client.query(sql);
  } finally {
    await client.end();
  }
}

/** Run a shell script, inherit stdio. Throws on non-zero exit. */
function runScript(scriptPath, args, env) {
  const result = spawnSync('bash', [scriptPath, ...args], {
    env: { ...process.env, ...env },
    stdio: 'inherit',
  });
  if (result.status !== 0) {
    throw new Error(`${scriptPath} ${args.join(' ')} exited ${result.status}`);
  }
}

async function step1_preflight() {
  header('Step 1 — Preflight + safety (source ≠ target)');
  if (!CONFIG.DATABASE_URL) {
    log(`  ${COLORS.red}DATABASE_URL not set — source DB required${COLORS.reset}`);
    return false;
  }
  const testUrl = CONFIG.DRILL_TEST_DATABASE_URL || deriveTestUrl(CONFIG.DATABASE_URL);
  if (!testUrl) {
    log(`  ${COLORS.red}Could not derive DRILL_TEST_DATABASE_URL — set it explicitly${COLORS.reset}`);
    return false;
  }
  CONFIG._testUrl = testUrl; // stash for later steps

  const src = parsePg(CONFIG.DATABASE_URL);
  const tgt = parsePg(testUrl);
  log(`  source:  ${src.host}/${src.dbname}`);
  log(`  target:  ${tgt.host}/${tgt.dbname}`);

  // SAFETY: source and target MUST differ in dbname (same host is OK — that's
  // the point of a test DB on the same cluster — but same dbname = dropping prod).
  if (src.dbname && src.dbname === tgt.dbname) {
    log(`  ${COLORS.red}SAFETY ABORT: source and target have the SAME dbname ('${tgt.dbname}').${COLORS.reset}`);
    log(`  ${COLORS.red}Drill would DROP this database. Set DRILL_TEST_DATABASE_URL to a different DB.${COLORS.reset}`);
    return false;
  }

  // Source reachable?
  try {
    await pgAdmin(CONFIG.DATABASE_URL, 'SELECT 1');
    log(`  ${pad('source reachable', 24)} ${COLORS.green}OK${COLORS.reset}`);
  } catch (err) {
    log(`  ${pad('source reachable', 24)} ${COLORS.red}FAIL${COLORS.reset} (${err.message})`);
    return false;
  }
  // Target host reachable? Connect to maintenance DB (postgres) on same host.
  const tgtMaint = testUrl.replace(/\/[^/]*$/, '/postgres');
  try {
    await pgAdmin(tgtMaint, 'SELECT 1');
    log(`  ${pad('target host reachable', 24)} ${COLORS.green}OK${COLORS.reset} (${tgt.host})`);
  } catch (err) {
    log(`  ${pad('target host reachable', 24)} ${COLORS.red}FAIL${COLORS.reset} (${err.message})`);
    return false;
  }
  return true;
}

async function step2_backup() {
  header('Step 2 — Backup source (pg_dump)');
  if (!existsSync(CONFIG.BACKUP_DIR)) mkdirSync(CONFIG.BACKUP_DIR, { recursive: true });
  const t0 = performance.now();
  runScript(path.resolve('tools/backup-postgres.sh'), ['backup'], {
    DATABASE_URL: CONFIG.DATABASE_URL,
    BACKUP_DIR: CONFIG.BACKUP_DIR,
  });
  const dt = ((performance.now() - t0) / 1000).toFixed(1);
  // Find the dump file just created (newest arbibot_*.sql.gz).
  const ls = spawnSync('bash', ['-c', `ls -t ${CONFIG.BACKUP_DIR}/arbibot_*.sql.gz 2>/dev/null | head -1`], {
    encoding: 'utf8',
  });
  const dumpFile = (ls.stdout || '').trim();
  if (!dumpFile) {
    throw new Error('backup produced no arbibot_*.sql.gz file');
  }
  log(`  dump: ${dumpFile}`);
  log(`  backup time: ${COLORS.green}${dt}s${COLORS.reset}`);
  return { dumpFile, seconds: Number(dt) };
}

async function step3_restore(backup) {
  header('Step 3 — Drop + recreate + restore target test DB');
  const tgt = parsePg(CONFIG._testUrl);
  const maintUrl = CONFIG._testUrl.replace(/\/[^/]*$/, '/postgres');

  const t0 = performance.now();
  // Drop + recreate (idempotent — drill may re-run).
  log(`  DROP DATABASE IF EXISTS "${tgt.dbname}"...`);
  await pgAdmin(maintUrl, `DROP DATABASE IF EXISTS "${tgt.dbname}"`);
  log(`  CREATE DATABASE "${tgt.dbname}"...`);
  await pgAdmin(maintUrl, `CREATE DATABASE "${tgt.dbname}"`);

  // Restore via the canonical script (--force, no confirm prompt).
  runScript(path.resolve('tools/backup-postgres.sh'), ['restore', backup.dumpFile, '--force'], {
    DATABASE_URL: CONFIG._testUrl,
  });
  const dt = ((performance.now() - t0) / 1000).toFixed(1);
  log(`  restore time: ${COLORS.green}${dt}s${COLORS.reset}`);
  return { seconds: Number(dt) };
}

async function step4_verify_migrations() {
  header('Step 4 — Verify migrations applied (target)');
  const verify = path.resolve('tools/verify-migrations-applied.mjs');
  const result = spawnSync('node', [verify, '--all'], {
    env: { ...process.env, DATABASE_URL: CONFIG._testUrl },
    stdio: 'inherit',
  });
  if (result.status !== 0) {
    log(`  ${COLORS.red}verify-migrations exited ${result.status}${COLORS.reset}`);
    return false;
  }
  // Count applied rows directly as a cross-check.
  const res = await pgAdmin(CONFIG._testUrl, 'SELECT count(*)::int AS n FROM schema_migrations');
  log(`  schema_migrations rows: ${COLORS.green}${res.rows[0].n}${COLORS.reset}`);
  return true;
}

async function step5_smoke() {
  header('Step 5 — Row-count smoke (target)');
  const tables = [
    'schema_migrations',
    'reconciliation_mismatches',
    'execution_plans',
    'paper_trades',
  ];
  const counts = {};
  let allOk = true;
  for (const t of tables) {
    try {
      const res = await pgAdmin(CONFIG._testUrl, `SELECT count(*)::int AS n FROM ${t}`);
      counts[t] = res.rows[0].n;
      log(`  ${pad(t, 32)} ${counts[t]} rows`);
    } catch (err) {
      counts[t] = null;
      log(`  ${pad(t, 32)} ${COLORS.red}ERROR${COLORS.reset} (${err.message})`);
      allOk = false;
    }
  }
  return { ok: allOk, counts };
}

async function step6_cleanup() {
  header('Step 6 — Cleanup');
  if (CONFIG.DRILL_KEEP_TEST_DB) {
    log(`  ${COLORS.yellow}DRILL_KEEP_TEST_DB=true${COLORS.reset} — test DB kept for manual inspection`);
    log(`  ${COLORS.dim}Manual cleanup: psql '${CONFIG._testUrl.replace(/\/[^/]*$/, '/postgres')}' -c "DROP DATABASE IF EXISTS \\"${parsePg(CONFIG._testUrl).dbname}\\";"${COLORS.reset}`);
    return { cleaned: false };
  }
  const tgt = parsePg(CONFIG._testUrl);
  const maintUrl = CONFIG._testUrl.replace(/\/[^/]*$/, '/postgres');
  await pgAdmin(maintUrl, `DROP DATABASE IF EXISTS "${tgt.dbname}"`);
  log(`  DROPPED test DB "${tgt.dbname}" → ${COLORS.green}cleaned${COLORS.reset}`);
  return { cleaned: true };
}

function printReport(steps, rto) {
  header('Drill #3 — Report');
  const rows = [
    ['preflight + safety', steps.preflight ? 'PASS' : 'FAIL'],
    ['backup', steps.backup ? `${steps.backup.seconds}s → ${path.basename(steps.backup.dumpFile || '')}` : 'FAIL'],
    ['restore', steps.restore ? `${steps.restore.seconds}s` : 'FAIL'],
    ['migrations verified', steps.migrations ? 'PASS' : steps.migrations === false ? 'FAIL' : '—'],
    ['row-count smoke', steps.smoke?.ok ? 'PASS' : steps.smoke ? 'FAIL' : '—'],
    ['cleanup', steps.cleanup?.cleaned === false ? 'kept' : steps.cleanup?.cleaned ? 'PASS' : 'FAIL'],
  ];
  for (const [name, value] of rows) {
    const color = /^PASS/.test(value)
      ? COLORS.green
      : /^FAIL/.test(value)
        ? COLORS.red
        : COLORS.reset;
    log(`  ${pad(name, 24)} ${color}${value}${COLORS.reset}`);
  }
  log('');
  if (rto) {
    log(`  RTO (backup + restore): ${COLORS.green}${rto.total.toFixed(1)}s${COLORS.reset}`);
    log(`  RPO: ~ backup interval (DRILL: ${rto.total.toFixed(0)}s end-to-end; prod claim = see docs/disaster-recovery-plan.md §RPO)`);
    log(`  ${COLORS.dim}Заявленные RTO 4h / RPO 24h (docs/disaster-recovery-plan.md) — drill измеряет ФАКТИЧЕСКОЕ время restore, не заявленное.${COLORS.reset}`);
  }
  log('');
  const pass =
    steps.preflight && steps.backup && steps.restore && steps.migrations && steps.smoke?.ok &&
    (steps.cleanup?.cleaned || CONFIG.DRILL_KEEP_TEST_DB);
  log(`  Verdict: ${pass ? COLORS.green + 'PASS' : COLORS.red + 'FAIL'}${COLORS.reset}`);
  log(`  ${COLORS.dim}Manual: for full smoke, run paper-trading-service against the restored test DB (DRILL_KEEP_TEST_DB=true).${COLORS.reset}`);
  log(`  ${COLORS.dim}See docs/disaster-recovery-plan.md and docs/drill-3-disaster-recovery.md.${COLORS.reset}`);
}

async function main() {
  log('');
  log('  Drill #3 — Disaster recovery (DB backup + restore)'.padEnd(72, ' '), COLORS.blue + '\x1b[1m');
  log('  ' + '━'.repeat(72), COLORS.blue);
  log(`  source DATABASE_URL: ${CONFIG.DATABASE_URL ? CONFIG.DATABASE_URL.replace(/:[^:@]+@/, ':***@') : '(not set)'}`);
  log(`  test DB:             ${CONFIG.DRILL_TEST_DATABASE_URL || '(derived: <source>_drill)'}`);
  log(`  dry run:             ${CONFIG.DRILL_DRY_RUN}`);
  log(`  keep test DB:        ${CONFIG.DRILL_KEEP_TEST_DB}`);

  const steps = { preflight: false, backup: null, restore: null, migrations: null, smoke: null, cleanup: null };
  let rto = null;

  try {
    steps.preflight = await step1_preflight();
    if (!steps.preflight) {
      printReport(steps, rto);
      process.exitCode = 2;
      return;
    }
    if (CONFIG.DRILL_DRY_RUN) {
      log(`\n  ${COLORS.green}✓ Dry-run OK: preflight + safety checked (no backup/restore/drop).${COLORS.reset}`);
      printReport(steps, rto);
      process.exitCode = 0;
      return;
    }
    steps.backup = await step2_backup();
    steps.restore = await step3_restore(steps.backup);
    rto = { total: steps.backup.seconds + steps.restore.seconds };
    steps.migrations = await step4_verify_migrations();
    steps.smoke = await step5_smoke();
    steps.cleanup = await step6_cleanup();
    printReport(steps, rto);
    const pass =
      steps.preflight && steps.backup && steps.restore && steps.migrations && steps.smoke?.ok &&
      (steps.cleanup?.cleaned || CONFIG.DRILL_KEEP_TEST_DB);
    process.exitCode = pass ? 0 : 1;
  } catch (err) {
    log(`\n  ${COLORS.red}Fatal error: ${err.message}${COLORS.reset}`);
    console.error(err);
    printReport(steps, rto);
    process.exitCode = 1;
  }
}

main();
