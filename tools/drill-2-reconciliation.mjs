#!/usr/bin/env node

/**
 * Drill #2 — Reconciliation P0 (mismatch detection + operator procedure)
 *
 * Симулирует reconciliation mismatch (kind = completed_plan_missing_portfolio),
 * проверяет цепочку: inject → reconciliation-service /mismatches → operator UI,
 * и репетирует operator procedure (investigating → resolved) из
 * docs/reconciliation-p0-procedures.md. Закрывает drill «Перед live с реальным
 * капиталом» (см. docs/TODO.md Drills).
 *
 * Что drill делает автоматически:
 *   1. Preflight: reconciliation-service жив, БД доступна.
 *   2. Baseline: считает текущие open mismatches.
 *   3. Inject: INSERT тестовой строки в reconciliation_mismatches с drill-маркером
 *      (details.planId = 'DRILL-<ts>', details.drill = true). Это симулирует
 *      detector, нашедший реальный mismatch — ровно то, что увидит оператор.
 *      Прямой INSERT безопаснее создания фейкового execution_plan (не трогает
 *      production-таблицы legs/portfolio) и полностью обратим (cleanup).
 *   4. Verify detection: GET /mismatches находит новый mismatch; опционально
 *      POST /mismatches/run-detectors — идемпотентен (не дублирует по kind+planId).
 *   5. Измеряет MTTA-возможность: drill-строка доступна в API сразу после inject.
 *   6. Cleanup: DELETE drill-строки по маркеру details->>'drill' = 'true'.
 *
 * Что drill НЕ делает (требует человека-оператора):
 *   - Открыть /incidents в Operator Web.
 *   - Эскалировать: investigating → resolved через UI (PATCH /mismatches/:id).
 *   - Замерить реальный MTTA/MTTR (время реакции оператора).
 *
 * Usage:
 *   node tools/drill-2-reconciliation.mjs
 *
 * Env:
 *   DATABASE_URL         — Postgres OLTP (default postgres://arbibot:arbibot@127.0.0.1:15432/arbibot)
 *   RECONCILIATION_URL   — reconciliation-service (default http://127.0.0.1:3017)
 *   DRILL_DRY_RUN        — `true`: только preflight + baseline, без inject (default false)
 *   DRILL_KEEP_INJECTED  — `true`: не удалять drill-строку после (для ручной отладки UI, default false)
 */

const CONFIG = {
  DATABASE_URL:
    process.env.DATABASE_URL || 'postgres://arbibot:arbibot@127.0.0.1:15432/arbibot',
  RECONCILIATION_URL: process.env.RECONCILIATION_URL || 'http://127.0.0.1:3017',
  DRILL_DRY_RUN: process.env.DRILL_DRY_RUN === 'true',
  DRILL_KEEP_INJECTED: process.env.DRILL_KEEP_INJECTED === 'true',
};

const MISMATCH_KIND = 'completed_plan_missing_portfolio';

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

function log(message, color = COLORS.reset) {
  console.log(`${color}${message}${COLORS.reset}`);
}

function header(title) {
  log('');
  log(`── ${title} `.padEnd(72, '─'), COLORS.cyan);
}

async function pg(query, params = []) {
  const pgMod = await import('pg');
  const client = new pgMod.Client({ connectionString: CONFIG.DATABASE_URL });
  try {
    await client.connect();
    const result = await client.query(query, params);
    return result;
  } finally {
    await client.end();
  }
}

async function httpGet(url) {
  const response = await fetch(url, { method: 'GET' });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText} @ ${url}`);
  }
  return response.json();
}

async function httpPost(url) {
  const response = await fetch(url, { method: 'POST' });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText} @ ${url}`);
  }
  return response.json().catch(() => ({}));
}

async function checkService(url, name, probe = '/health') {
  try {
    const response = await fetch(url + probe, { method: 'GET' });
    if (response.ok) {
      log(`  ${pad(name, 32)} ${COLORS.green}OK${COLORS.reset} (${probe}, ${response.status})`);
      return true;
    }
    log(`  ${pad(name, 32)} ${COLORS.yellow}DEGRADED${COLORS.reset} (${probe}, ${response.status})`);
    return false;
  } catch (err) {
    log(`  ${pad(name, 32)} ${COLORS.red}DOWN${COLORS.reset} (${err.message})`);
    return false;
  }
}

async function step1_preflight() {
  header('Step 1 — Preflight (services alive)');
  const checks = await Promise.all([
    checkService(CONFIG.RECONCILIATION_URL, 'reconciliation-service', '/health'),
  ]);
  // DB connectivity
  try {
    await pg('SELECT 1');
    log(`  ${pad('postgres (DATABASE_URL)', 32)} ${COLORS.green}OK${COLORS.reset}`);
    checks.push(true);
  } catch (err) {
    log(`  ${pad('postgres (DATABASE_URL)', 32)} ${COLORS.red}DOWN${COLORS.reset} (${err.message})`);
    checks.push(false);
  }
  return checks.every(Boolean);
}

async function step2_baseline() {
  header('Step 2 — Baseline (current open mismatches)');
  const res = await pg(
    `SELECT kind, count(*)::int AS n FROM reconciliation_mismatches
     WHERE status = 'open' AND NOT (details->>'drill' = 'true')
     GROUP BY kind ORDER BY kind`,
  );
  const byKind = {};
  for (const row of res.rows) {
    byKind[row.kind] = row.n;
    log(`  ${pad(row.kind, 48)} ${row.n}`);
  }
  const total = res.rows.reduce((s, r) => s + r.n, 0);
  log(`  ${pad('TOTAL (non-drill) open', 48)} ${total}`);
  return { byKind, total };
}

async function step3_inject() {
  header('Step 3 — Inject simulated mismatch (drill marker)');
  const ts = new Date().toISOString().replace(/[:.]/g, '');
  const planId = `DRILL-${ts}`;
  const res = await pg(
    `INSERT INTO reconciliation_mismatches (kind, status, details, entity_version)
     VALUES ($1::text, 'open', jsonb_build_object('planId', $2::text, 'drill', true, 'injectedAt', now()::text), 1)
     RETURNING id, details`,
    [MISMATCH_KIND, planId],
  );
  const row = res.rows[0];
  log(`  Injected id=${row.id}`);
  log(`  kind=${MISMATCH_KIND}`);
  log(`  details.planId=${planId}`);
  return { id: row.id, planId };
}

async function step4_verify_detection(injected) {
  header('Step 4 — Verify detection via reconciliation API');
  // GET /mismatches должен показать injected строку.
  const data = await httpGet(`${CONFIG.RECONCILIATION_URL}/mismatches`);
  const items = Array.isArray(data) ? data : data.items ?? [];
  const found = items.find(
    (it) => it.id === injected.id || it.details?.planId === injected.planId,
  );
  if (found) {
    log(`  GET /mismatches → drill row ${COLORS.green}VISIBLE${COLORS.reset} (id=${found.id}, status=${found.status})`);
  } else {
    log(`  GET /mismatches → drill row ${COLORS.red}NOT FOUND${COLORS.reset}`);
    return { visible: false, idempotent: null };
  }

  // POST /mismatches/run-detectors — идемпотентен: не должен дублировать (kind, planId).
  let idempotent = null;
  try {
    const before = await pg(
      `SELECT count(*)::int AS n FROM reconciliation_mismatches
       WHERE kind = $1 AND details->>'planId' = $2 AND status = 'open'`,
      [MISMATCH_KIND, injected.planId],
    );
    await httpPost(`${CONFIG.RECONCILIATION_URL}/mismatches/run-detectors`);
    const after = await pg(
      `SELECT count(*)::int AS n FROM reconciliation_mismatches
       WHERE kind = $1 AND details->>'planId' = $2 AND status = 'open'`,
      [MISMATCH_KIND, injected.planId],
    );
    idempotent = before.rows[0].n === after.rows[0].n;
    log(
      `  POST /run-detectors → ${idempotent ? COLORS.green + 'IDEMPOTENT' : COLORS.yellow + 'DUPLICATED'}${COLORS.reset} (open rows for planId: ${before.rows[0].n} → ${after.rows[0].n})`,
    );
  } catch (err) {
    log(`  POST /run-detectors → ${COLORS.yellow}SKIPPED${COLORS.reset} (${err.message})`);
  }

  return { visible: true, idempotent };
}

async function step5_cleanup(injected) {
  header('Step 5 — Cleanup (remove drill row)');
  if (CONFIG.DRILL_KEEP_INJECTED) {
    log(`  ${COLORS.yellow}DRILL_KEEP_INJECTED=true${COLORS.reset} — row kept for manual UI debugging (id=${injected.id})`);
    log(`  Manual cleanup: DELETE FROM reconciliation_mismatches WHERE id = '${injected.id}';`);
    return { cleaned: false, kept: true };
  }
  const res = await pg(
    `DELETE FROM reconciliation_mismatches WHERE id = $1::uuid RETURNING id`,
    [injected.id],
  );
  const cleaned = res.rows.length > 0;
  log(
    `  DELETE drill row → ${cleaned ? COLORS.green + 'REMOVED' : COLORS.red + 'NOT FOUND'}${COLORS.reset} (id=${injected.id})`,
  );
  // Safety net: remove any leftover drill rows from prior aborted runs.
  const leftover = await pg(
    `DELETE FROM reconciliation_mismatches WHERE details->>'drill' = 'true' RETURNING id`,
  );
  if (leftover.rows.length > 0) {
    log(`  ${COLORS.dim}Also removed ${leftover.rows.length} leftover drill row(s) from prior runs.${COLORS.reset}`);
  }
  return { cleaned, kept: false };
}

function printReport(steps) {
  header('Drill #2 — Report');
  const rows = [
    ['preflight', steps.preflight ? 'PASS' : 'FAIL'],
    ['baseline', steps.baseline ? `${steps.baseline.total} open (non-drill)` : '—'],
    ['inject', steps.injected ? `inserted id=${steps.injected.id}` : '—'],
    ['visible via API', steps.detected?.visible ? 'PASS' : steps.detected ? 'FAIL' : '—'],
    ['detector idempotent', steps.detected?.idempotent === null ? 'skipped' : steps.detected?.idempotent ? 'PASS' : 'WARN'],
    ['cleanup', steps.cleanup?.kept ? 'kept (DRILL_KEEP_INJECTED)' : steps.cleanup?.cleaned ? 'PASS' : 'FAIL'],
  ];
  for (const [name, value] of rows) {
    const color = /^PASS/.test(value)
      ? COLORS.green
      : /^FAIL/.test(value)
        ? COLORS.red
        : /^WARN/.test(value)
          ? COLORS.yellow
          : COLORS.reset;
    log(`  ${pad(name, 24)} ${color}${value}${COLORS.reset}`);
  }
  log('');
  const autoPass =
    steps.preflight &&
    steps.injected &&
    steps.detected?.visible &&
    (steps.detected.idempotent === null || steps.detected.idempotent) &&
    (steps.cleanup?.cleaned || steps.cleanup?.kept);
  log(
    `  Auto verdict: ${autoPass ? COLORS.green + 'PASS' : COLORS.red + 'FAIL'}${COLORS.reset}`,
  );
  log(`  ${COLORS.dim}Manual (operator): open /incidents → filter open → set investigating → resolve. Measure MTTA/MTTR.${COLORS.reset}`);
  log(`  ${COLORS.dim}See docs/reconciliation-p0-procedures.md and docs/drill-2-reconciliation.md.${COLORS.reset}`);
}

async function main() {
  log('');
  log('  Drill #2 — Reconciliation P0'.padEnd(72, ' '), COLORS.blue + '\x1b[1m');
  log('  ' + '━'.repeat(72), COLORS.blue);
  log(`  kind:       ${MISMATCH_KIND}`);
  log(`  dry run:    ${CONFIG.DRILL_DRY_RUN}`);
  log(`  keep:       ${CONFIG.DRILL_KEEP_INJECTED}`);
  log(`  recon url:  ${CONFIG.RECONCILIATION_URL}`);
  log(`  db:         ${CONFIG.DATABASE_URL.replace(/:[^:@]+@/, ':***@')}`);

  const steps = { preflight: false, baseline: null, injected: null, detected: null, cleanup: null };

  try {
    steps.preflight = await step1_preflight();
    if (!steps.preflight) {
      printReport(steps);
      process.exitCode = 2;
      return;
    }
    steps.baseline = await step2_baseline();
    if (CONFIG.DRILL_DRY_RUN) {
      log(`\n  ${COLORS.green}✓ Dry-run OK: preflight + baseline checked (no injection).${COLORS.reset}`);
      printReport(steps);
      process.exitCode = 0;
      return;
    }
    steps.injected = await step3_inject();
    steps.detected = await step4_verify_detection(steps.injected);
    steps.cleanup = await step5_cleanup(steps.injected);
    printReport(steps);
    const autoPass =
      steps.preflight &&
      steps.injected &&
      steps.detected?.visible &&
      (steps.detected.idempotent === null || steps.detected.idempotent) &&
      (steps.cleanup?.cleaned || steps.cleanup?.kept);
    process.exitCode = autoPass ? 0 : 1;
  } catch (err) {
    log(`\n  ${COLORS.red}Fatal error: ${err.message}${COLORS.reset}`);
    console.error(err);
    // Best-effort cleanup on fatal.
    if (steps.injected && !CONFIG.DRILL_KEEP_INJECTED) {
      try {
        await pg(`DELETE FROM reconciliation_mismatches WHERE id = $1::uuid`, [steps.injected.id]);
        log(`  ${COLORS.dim}Fatal-path cleanup: removed drill row ${steps.injected.id}.${COLORS.reset}`);
      } catch {
        /* swallow */
      }
    }
    printReport(steps);
    process.exitCode = 1;
  }
}

main();
