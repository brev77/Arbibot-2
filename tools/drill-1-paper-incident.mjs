#!/usr/bin/env node

/**
 * Drill #1 — Paper incident (drift high)
 *
 * Симулирует высокий paper drift, чтобы сработал alert `PaperDriftBpsHigh`,
 * затем проверяет цепочку: drift samples → metric gauge → Prometheus → Alertmanager.
 *
 * Что drill делает автоматически:
 *   1. Проверяет что paper-trading-service живой и метрики `/metrics` отдаются.
 *   2. Проверяет что recording-rule `arb_paper_drift_bps_avg_5m` уже материализована в Prometheus.
 *   3. POST'ит серию drift samples (drift_bps = 75 > порога 50) в `/paper/drift-samples`,
 *      что вызывает `PaperDriftService.record()` и мгновенно обновляет Prometheus gauge
 *      `arb_paper_drift_bps_current`. Прямой SQL INSERT не работает — gauge ставится
 *      только в сервисном слое `record()`, а не в БД-триггере.
 *   5. Ждёт 1–2 цикла scrape_interval + recording window и опрашивает Prometheus:
 *        - arb_paper_drift_bps_avg_5m
 *        - ALERTS{alertname="PaperDriftBpsHigh", alertstate="firing"}
 *   6. Опрашивает Alertmanager API (`/api/v2/alerts`) на наличие активного алерта.
 *   7. Выводит финальный drill-отчёт (pass/fail по каждому шагу + рекомендация для оператора).
 *
 * Что drill НЕ делает (требует человека-оператора):
 *   - Открыть /incidents в Operator Web.
 *   - Эскалировать инцидент: investigating → resolved.
 *   - Замерить MTTA/MTTR (< 30m по критерию успеха).
 *
 * Usage:
 *   node tools/drill-1-paper-incident.mjs
 *
 * Env:
 *   DATABASE_URL             — Postgres OLTP (default: postgres://arbibot:arbibot@127.0.0.1:15432/arbibot)
 *   PAPER_TRADING_URL        — paper-trading-service (default: http://127.0.0.1:3018)
 *   PROMETHEUS_URL           — Prometheus (default: http://127.0.0.1:9090)
 *   ALERTMANAGER_URL         — Alertmanager (default: http://127.0.0.1:9093)
 *   DRILL_INSTRUMENT_KEY     — instrument для симуляции (default: DRILL-BTC-USDC)
 *   DRILL_TARGET_BPS         — целевой drift (default: 75)
 *   DRILL_SETTLE_SECONDS     — сколько ждать firing (default: 720s = 5m recording window + 5m alert `for:` + ~120s jitter). Не уменьшайте ниже 600s иначе алерт не успеет перейти из pending в firing.
 *   DRILL_DRY_RUN            — `true`: только проверки, без инъекции (default: false)
 */

import { performance } from 'perf_hooks';

const CONFIG = {
  DATABASE_URL: process.env.DATABASE_URL || 'postgres://arbibot:arbibot@127.0.0.1:15432/arbibot',
  PAPER_TRADING_URL: process.env.PAPER_TRADING_URL || 'http://127.0.0.1:3018',
  PROMETHEUS_URL: process.env.PROMETHEUS_URL || 'http://127.0.0.1:9090',
  ALERTMANAGER_URL: process.env.ALERTMANAGER_URL || 'http://127.0.0.1:9093',
  DRILL_INSTRUMENT_KEY: process.env.DRILL_INSTRUMENT_KEY || 'DRILL-BTC-USDC',
  DRILL_TARGET_BPS: Number(process.env.DRILL_TARGET_BPS || 75),
  DRILL_SETTLE_SECONDS: Number(process.env.DRILL_SETTLE_SECONDS || 720),
  DRILL_DRY_RUN: process.env.DRILL_DRY_RUN === 'true',
};

const ALERT_RULE = 'PaperDriftBpsHigh';
const METRIC_CURRENT = 'arb_paper_drift_bps_current';
const METRIC_AVG_5M = 'arb_paper_drift_bps_avg_5m';

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

async function pg(sql) {
  const pgMod = await import('pg');
  const client = new pgMod.Client({ connectionString: CONFIG.DATABASE_URL });
  try {
    await client.connect();
    const result = await client.query(sql);
    return result;
  } finally {
    await client.end();
  }
}

async function httpGet(url) {
  const response = await fetch(url, { method: 'GET' });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}`);
  }
  const text = await response.text();
  const ct = response.headers.get('content-type') || '';
  if (ct.includes('application/json')) {
    return JSON.parse(text);
  }
  return text;
}

async function promQuery(query) {
  const url = `${CONFIG.PROMETHEUS_URL}/api/v1/query?query=${encodeURIComponent(query)}`;
  const data = await httpGet(url);
  if (data.status !== 'success') {
    throw new Error(`Prometheus error: ${JSON.stringify(data)}`);
  }
  return data.data.result;
}

async function promScalarOrZero(query) {
  const result = await promQuery(query);
  if (!Array.isArray(result) || result.length === 0) return null;
  const first = result[0];
  const value = Array.isArray(first.value) ? Number(first.value[1]) : Number(first.value);
  return Number.isFinite(value) ? value : null;
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
  // paper-trading-service exposes /metrics (NestJS prometheus plugin), not /health
  const checks = await Promise.all([
    checkService(CONFIG.PAPER_TRADING_URL, 'paper-trading-service', '/metrics'),
    checkService(CONFIG.PROMETHEUS_URL, 'prometheus', '/-/ready'),
    checkService(CONFIG.ALERTMANAGER_URL, 'alertmanager', '/-/ready'),
  ]);
  return checks.every(Boolean);
}

async function step2_verify_rule_loaded() {
  header('Step 2 — Verify alert rule is loaded in Prometheus');
  try {
    const rules = await httpGet(`${CONFIG.PROMETHEUS_URL}/api/v1/rules`);
    const ruleNames = [];
    for (const group of rules.data?.groups ?? []) {
      for (const rule of group.rules ?? []) {
        if (rule.name) ruleNames.push(rule.name);
      }
    }
    const hasHigh = ruleNames.includes('PaperDriftBpsHigh');
    const hasSustained = ruleNames.includes('PaperDriftBpsSustainedHigh');
    log(`  PaperDriftBpsHigh:        ${hasHigh ? COLORS.green + 'LOADED' : COLORS.red + 'MISSING'}${COLORS.reset}`);
    log(`  PaperDriftBpsSustainedHigh: ${hasSustained ? COLORS.green + 'LOADED' : COLORS.red + 'MISSING'}${COLORS.reset}`);
    return hasHigh;
  } catch (err) {
    log(`  ${COLORS.red}Prometheus /api/v1/rules error: ${err.message}${COLORS.reset}`);
    return false;
  }
}

async function step3_baseline_metrics() {
  header('Step 3 — Baseline metrics');
  const baseline = {
    current: await promScalarOrZero(METRIC_CURRENT),
    avg5m: await promScalarOrZero(METRIC_AVG_5M),
    firingAlerts: await promQuery(`ALERTS{alertname="${ALERT_RULE}",alertstate="firing"}`),
  };
  log(`  ${METRIC_CURRENT}: ${baseline.current ?? '—'}`);
  log(`  ${METRIC_AVG_5M}:   ${baseline.avg5m ?? '—'}  (threshold = 50 bps)`);
  log(`  ${ALERT_RULE} firing count: ${baseline.firingAlerts.length}`);
  if (baseline.firingAlerts.length > 0) {
    log(`  ${COLORS.yellow}⚠  Alert уже firing — drill будет некорректным (drift не вернётся к нулю).${COLORS.reset}`);
  }
  return baseline;
}

async function postDriftSample(payload) {
  const url = `${CONFIG.PAPER_TRADING_URL}/paper/drift-samples`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`HTTP ${response.status} ${response.statusText}: ${text}`);
  }
  return response.json();
}

async function step4_inject_drift() {
  header(`Step 4 — Inject high drift (target = ${CONFIG.DRILL_TARGET_BPS} bps)`);
  if (CONFIG.DRILL_DRY_RUN) {
    log(`  ${COLORS.yellow}DRILL_DRY_RUN=true — injection SKIPPED${COLORS.reset}`);
    return { injected: 0 };
  }
  const instrumentKey = CONFIG.DRILL_INSTRUMENT_KEY;
  const targetBps = CONFIG.DRILL_TARGET_BPS;
  // ВАЖНО: прямой SQL INSERT в paper_drift_samples НЕ обновляет Prometheus-метрику
  // `arb_paper_drift_bps_current` — gauge ставится только в PaperDriftService.record(),
  // который вызывается через HTTP `POST /paper/drift-samples`. Поэтому drill инжектирует
  // через HTTP API, а не через БД напрямую.
  // Серия сэмплов с интервалом ~1s нужна, чтобы recording rule avg_over_time
  // (5m window) набрала достаточно точек для надёжного firing.
  const sampleValues = Array.from({ length: 12 }, (_, i) => targetBps + (i % 3) - 1);
  let injected = 0;
  let lastErr = null;
  for (const bps of sampleValues) {
    const payload = {
      instrumentKey,
      paperMid: '45000',
      referenceMid: (45000 * (1 + bps / 1e6)).toFixed(6),
      driftBps: bps,
    };
    try {
      await postDriftSample(payload);
      injected++;
      process.stdout.write(`  ${COLORS.dim}.${COLORS.reset}`);
    } catch (err) {
      lastErr = err;
      log(`\n  ${COLORS.red}POST /paper/drift-samples failed: ${err.message}${COLORS.reset}`);
      break;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  log('');
  if (injected > 0) {
    log(`  ${COLORS.green}Injected ${injected} drift samples${COLORS.reset} via POST /paper/drift-samples (instrumentKey='${instrumentKey}')`);
    log(`  ${COLORS.dim}Values: ${sampleValues.join(',')}${COLORS.reset}`);
  }
  return { injected, instrumentKey, error: lastErr?.message };
}

async function step5_wait_and_verify(settleSeconds, baseline) {
  header(`Step 5 — Wait ${settleSeconds}s for recording rules + alert "for: 5m"`);
  const start = performance.now();
  const checks = [];
  const intervalMs = 15_000;
  let elapsed = 0;
  while (elapsed < settleSeconds * 1000) {
    const t1 = await promScalarOrZero(METRIC_CURRENT);
    const t5 = await promScalarOrZero(METRIC_AVG_5M);
    const firing = await promQuery(`ALERTS{alertname="${ALERT_RULE}",alertstate="firing"}`);
    const amAlerts = await getAlertmanagerActive();
    const state = {
      elapsedSec: Math.round(elapsed / 1000),
      current: t1,
      avg5m: t5,
      promFiring: firing.length,
      amActive: amAlerts.length,
    };
    checks.push(state);
    log(
      `  [t=${String(state.elapsedSec).padStart(3, ' ')}s] current=${state.current ?? '—'}  ` +
      `avg5m=${state.avg5m ?? '—'}  promFiring=${state.promFiring}  amActive=${state.amActive}`
    );
    if (state.promFiring > 0 && state.amActive > 0) {
      log(`  ${COLORS.green}✓ Alert fired AND delivered to Alertmanager — drill target reached early.${COLORS.reset}`);
      return { success: true, checks, baseline };
    }
    await new Promise((r) => setTimeout(r, intervalMs));
    elapsed = performance.now() - start;
  }
  const final = checks[checks.length - 1];
  const success = (final?.promFiring ?? 0) > 0;
  return { success, checks, baseline };
}

async function getAlertmanagerActive() {
  try {
    const url = `${CONFIG.ALERTMANAGER_URL}/api/v2/alerts?active=true&silenced=false&inhibited=false`;
    const data = await httpGet(url);
    return Array.isArray(data) ? data.filter((a) => a.labels?.alertname === ALERT_RULE) : [];
  } catch (err) {
    return [];
  }
}

function printReport(steps) {
  header('Drill #1 — Report');
  // В dry-run эти шаги пропускаются намеренно — показываем как SKIP, не FAIL
  const skipInDryRun = CONFIG.DRILL_DRY_RUN
    ? new Set(['drift injection', 'alert firing (Prometheus)', 'alert delivered (Alertmanager)'])
    : new Set();
  const rows = [
    ['preflight', steps.preflight],
    ['rule loaded', steps.ruleLoaded],
    ['baseline metrics', steps.baseline !== null],
    ['drift injection', steps.injected > 0],
    ['alert firing (Prometheus)', steps.firing],
    ['alert delivered (Alertmanager)', steps.delivered],
  ];
  for (const [name, ok] of rows) {
    const mark = skipInDryRun.has(name)
      ? `${COLORS.yellow}SKIP${COLORS.reset} (dry-run)`
      : ok
        ? `${COLORS.green}PASS${COLORS.reset}`
        : `${COLORS.red}FAIL${COLORS.reset}`;
    log(`  ${pad(name, 36)} ${mark}`);
  }
  const counted = rows.filter(([name]) => !skipInDryRun.has(name));
  const passed = counted.filter(([, ok]) => ok).length;
  const total = counted.length;
  log('');
  if (CONFIG.DRILL_DRY_RUN) {
    log(`  ${COLORS.green}✓ Drill #1 DRY-RUN passed (${passed}/${total} preflight checks OK).${COLORS.reset}`);
    log(`  ${COLORS.cyan}→ Dry-run: только проверки готовности, без инъекции и ожидания alert.${COLORS.reset}`);
    log(`  ${COLORS.cyan}→ Для полного прогона: unset DRILL_DRY_RUN && npm run drill:1${COLORS.reset}`);
    return;
  }
  if (passed === total) {
    log(`  ${COLORS.green}✓ Drill #1 AUTOMATED PART passed (${passed}/${total}).${COLORS.reset}`);
    log(`  ${COLORS.cyan}→ Now hand off to operator:${COLORS.reset}`);
    log(`      1. Open Operator Web → /incidents`);
    log(`      2. Verify PaperDriftBpsHigh incident is listed`);
    log(`      3. Escalate: open → investigating → resolved`);
    log(`      4. Record MTTA / MTTR (target: < 30m total)`);
    log(`      5. Cleanup: ${COLORS.dim}DELETE FROM paper_drift_samples WHERE instrument_key='${CONFIG.DRILL_INSTRUMENT_KEY}';${COLORS.reset}`);
  } else {
    log(`  ${COLORS.red}✗ Drill #1 AUTOMATED PART failed (${passed}/${total}).${COLORS.reset}`);
    log(`  ${COLORS.yellow}Troubleshooting:${COLORS.reset}`);
    if (!steps.preflight) {
      log(`    • Поднять observability-стек: docker compose -f infra/docker-compose.dev.yml --profile observability up -d`);
      log(`    • Поднять backend-сервисы:    npm run dev:paper (или npm run dev:stack:full для всего)`);
    }
    if (!steps.ruleLoaded) {
      log(`    • Проверить что infra/prometheus/alerts.yml и grafana/recording-rules/* подгружены в Prometheus`);
      log(`    • Проверить что prometheus.yml содержит оба rule_files`);
    }
    if (steps.preflight && !steps.firing) {
      log(`    • Метрика не выросла — проверить updateStaleGauges в paper-trading-service`);
      log(`    • Scrape interval может быть длиннее 15s — увеличить DRILL_SETTLE_SECONDS`);
    }
    if (steps.firing && !steps.delivered) {
      log(`    • Alertmanager не получил алерт — проверить Prometheus alertmanager_configs`);
      log(`    • Проверить Alertmanager receivers (Slack/Telegram webhook)`);
    }
  }
}

async function main() {
  log('');
  log('  Drill #1 — Paper incident (drift high)'.padEnd(72, ' '), COLORS.blue + '\x1b[1m');
  log('  ' + '━'.repeat(72), COLORS.blue);
  log(`  instrument: ${CONFIG.DRILL_INSTRUMENT_KEY}`);
  log(`  target bps: ${CONFIG.DRILL_TARGET_BPS} (> 50 threshold)`);
  log(`  dry run:    ${CONFIG.DRILL_DRY_RUN}`);
  log(`  settle:     ${CONFIG.DRILL_SETTLE_SECONDS}s`);
  log(`  paper url:  ${CONFIG.PAPER_TRADING_URL}`);
  log(`  prom url:   ${CONFIG.PROMETHEUS_URL}`);
  log(`  am url:     ${CONFIG.ALERTMANAGER_URL}`);

  const steps = {
    preflight: false,
    ruleLoaded: false,
    baseline: null,
    injected: 0,
    firing: false,
    delivered: false,
  };

  try {
    steps.preflight = await step1_preflight();
    if (!steps.preflight) {
      printReport(steps);
      process.exitCode = 2;
      return;
    }
    steps.ruleLoaded = await step2_verify_rule_loaded();
    if (!steps.ruleLoaded) {
      printReport(steps);
      process.exitCode = 2;
      return;
    }
    steps.baseline = await step3_baseline_metrics();
    const injected = await step4_inject_drift();
    steps.injected = injected.injected || 0;
    if (CONFIG.DRILL_DRY_RUN) {
      log(`  ${COLORS.green}✓ Dry-run OK: preflight + rule loaded + baseline checked (no injection, no wait).${COLORS.reset}`);
      printReport(steps);
      // Не вызываем process.exit() — libuv на Windows падает на exit с открытыми async handles (PG client/fetch).
      // process.exitCode позволит node корректно завершиться после очистки event loop.
      process.exitCode = 0;
      return;
    }
    if (steps.injected === 0) {
      printReport(steps);
      process.exitCode = 3;
      return;
    }
    const result = await step5_wait_and_verify(CONFIG.DRILL_SETTLE_SECONDS, steps.baseline);
    steps.firing = result.success || (await promScalarOrZero(`scalar(count(ALERTS{alertname="${ALERT_RULE}",alertstate="firing"} > 0))`)) === 1;
    const amActive = await getAlertmanagerActive();
    steps.delivered = amActive.length > 0;
    printReport(steps);
    process.exitCode = steps.firing && steps.delivered ? 0 : 1;
  } catch (err) {
    log(`\n  ${COLORS.red}Fatal error: ${err.message}${COLORS.reset}`);
    console.error(err);
    printReport(steps);
    process.exitCode = 1;
  }
}

main();