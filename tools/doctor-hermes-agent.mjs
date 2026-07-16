#!/usr/bin/env node
/**
 * Hermes Agent — проверка готовности (doctor).
 * Проверяет: собран ли MCP-сервер, заданы ли обязательные env-переменные,
 * отвечает ли Hermes Gateway, валиден ли ключ.
 *
 * Usage:
 *   npm run doctor:hermes
 *   node tools/doctor-hermes-agent.mjs
 *
 * Read-only: ничего не запускает, только делает GET-запросы к gateway.
 * Exit code: 0 — всё ок (warnings допустимы), 1 — есть блокирующие ошибки.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

const MCP_DIST = path.join(repoRoot, 'packages/hermes-mcp-server/dist/index.js');
const CONFIG_YAML = path.join(repoRoot, 'tools/hermes-agent/hermes-config.yaml');

// Обязательные env-переменные для запуска агента с GLM 5.2 + Telegram.
const REQUIRED_ENV = [
  'HERMES_LLM_API_KEY',
  'TELEGRAM_BOT_TOKEN',
  'OPERATOR_TELEGRAM_ID',
  'HERMES_API_KEY',
];

// Необязательные, но с дефолтами — покажем фактические значения.
const OPTIONAL_ENV = [
  'HERMES_LLM_PROVIDER',
  'HERMES_LLM_MODEL',
  'HERMES_LLM_BASE_URL',
  'HERMES_TELEGRAM_ENABLED',
  'HERMES_GATEWAY_URL',
  'HERMES_CRON_ENABLED',
];

const gatewayUrl = (process.env.HERMES_GATEWAY_URL ?? 'http://127.0.0.1:3020').replace(/\/$/, '');
const hermesKey = process.env.HERMES_API_KEY ?? '';

let errors = 0;
let warnings = 0;

function ok(msg) {
  console.log(`  \u2713 ${msg}`);
}
function warn(msg) {
  warnings++;
  console.log(`  \u26a0  ${msg}`);
}
function fail(msg) {
  errors++;
  console.log(`  \u2717 ${msg}`);
}
function section(title) {
  console.log(`\n\u2588 ${title}`);
}

// --- 1. Файлы ---
section('1. Файлы конфигурации');
if (fs.existsSync(CONFIG_YAML)) {
  ok(`Конфиг найден: ${path.relative(repoRoot, CONFIG_YAML)}`);
} else {
  fail(`Конфиг НЕ найден: ${CONFIG_YAML}`);
}

if (fs.existsSync(MCP_DIST)) {
  ok(`MCP-сервер собран: ${path.relative(repoRoot, MCP_DIST)}`);
} else {
  fail(`MCP-сервер НЕ собран. Запустите: npm run build:hermes-mcp`);
}

// --- 2. Обязательные env ---
section('2. Обязательные переменные окружения (env / .env)');
for (const name of REQUIRED_ENV) {
  if (process.env[name] && process.env[name].trim() !== '') {
    ok(`${name} задан`);
  } else {
    fail(`${name} НЕ задан — обязательно для запуска агента`);
  }
}

// --- 3. Необязательные env (показать фактические значения) ---
section('3. Настройки провайдера и Telegram');
for (const name of OPTIONAL_ENV) {
  const val = process.env[name];
  if (val === undefined) {
    console.log(`  \u00b7 ${name} = <не задан, будет дефолт из hermes-config.yaml>`);
  } else {
    // Не печатаем секреты целиком.
    const safe = name.includes('KEY') || name.includes('TOKEN') ? `${val.slice(0, 4)}…(скрыто)` : val;
    console.log(`  \u00b7 ${name} = ${safe}`);
  }
}
if ((process.env.HERMES_LLM_PROVIDER ?? 'openai') === 'openai') {
  ok('Провайдер: openai (GLM 5.2 через OpenAI-совместимый base_url)');
} else if (process.env.HERMES_LLM_PROVIDER) {
  warn(`Провайдер: ${process.env.HERMES_LLM_PROVIDER} (ожидался openai для GLM 5.2)`);
}

// --- 4. Hermes Gateway ---
section('4. Hermes Gateway');
if (!hermesKey) {
  fail('HERMES_API_KEY не задан — проверку gateway пропускаем с ошибкой');
} else {
  try {
    const healthRes = await fetch(`${gatewayUrl}/health`, { signal: AbortSignal.timeout(3000) });
    if (healthRes.ok) {
      ok(`Gateway отвечает: GET ${gatewayUrl}/health -> ${healthRes.status}`);
    } else {
      warn(`Gateway вернул ${healthRes.status} на GET /health`);
    }
  } catch (e) {
    warn(`Gateway недоступен на ${gatewayUrl}: ${e.message}. Запустите: npm run dev:hermes`);
  }

  // Проверка ключа через read-only эндпоинт.
  try {
    const authRes = await fetch(`${gatewayUrl}/hermes/v1/dashboard/summary`, {
      headers: { 'x-hermes-api-key': hermesKey },
      signal: AbortSignal.timeout(3000),
    });
    if (authRes.status === 401 || authRes.status === 403) {
      fail(`Ключ HERMES_API_KEY отклонён gateway (status ${authRes.status}). Проверьте совпадение с HERMES_API_KEYS на gateway`);
    } else if (authRes.ok) {
      ok('Ключ HERMES_API_KEY принят gateway (dashboard/summary доступен)');
    } else {
      warn(`Gateway ответил ${authRes.status} на dashboard/summary (возможно upstream недоступен — это не блокер для агента)`);
    }
  } catch (e) {
    warn(`Не удалось проверить ключ на gateway: ${e.message}`);
  }
}

// --- Итог ---
console.log('');
if (errors > 0) {
  console.log(`\u2717 Doctor: ${errors} ошибок, ${warnings} предупреждений. Агент НЕ готов к запуску.`);
  process.exit(1);
}
if (warnings > 0) {
  console.log(`\u2713 Doctor: нет блокирующих ошибок, но ${warnings} предупреждений. Агент должен запускаться.`);
} else {
  console.log('\u2713 Doctor: всё готово. Можно запускать: npm run run:hermes');
}
process.exit(0);
