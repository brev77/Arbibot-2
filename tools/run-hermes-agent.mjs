#!/usr/bin/env node
/**
 * Hermes Agent — обёртка запуска внешнего агента (NousResearch Hermes Agent).
 *
 * Что делает:
 *   1. Проверяет, что собран MCP-сервер (пререквизит).
 *   2. Проверяет обязательные env-переменные (GLM-ключ, Telegram-токен, ID оператора, ключ gateway).
 *   3. Запускает внешний бинарник `hermes` с конфигом tools/hermes-agent/hermes-config.yaml.
 *
 * Usage:
 *   npm run run:hermes
 *   node tools/run-hermes-agent.mjs
 *
 * Внешний агент ставится отдельно (см. tools/hermes-agent/README.md).
 * Если `hermes` не найден в PATH — выходим с понятной ошибкой и инструкцией.
 */
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

const MCP_DIST = path.join(repoRoot, 'packages/hermes-mcp-server/dist/index.js');
const CONFIG_YAML = path.join(repoRoot, 'tools/hermes-agent/hermes-config.yaml');

const REQUIRED_ENV = ['HERMES_LLM_API_KEY', 'TELEGRAM_BOT_TOKEN', 'OPERATOR_TELEGRAM_ID', 'HERMES_API_KEY'];

function die(msg) {
  console.error(`\u2717 ${msg}`);
  process.exit(1);
}

// 1. Файлы.
if (!fs.existsSync(MCP_DIST)) {
  die('MCP-сервер не собран. Запустите сначала: npm run build:hermes-mcp');
}
if (!fs.existsSync(CONFIG_YAML)) {
  die(`Конфиг не найден: ${CONFIG_YAML}`);
}

// 2. Env.
const missing = REQUIRED_ENV.filter((n) => !process.env[n] || process.env[n].trim() === '');
if (missing.length > 0) {
  console.error('\u2717 Не заданы обязательные переменные окружения:');
  for (const n of missing) console.error(`    - ${n}`);
  console.error('  Заполните .env (см. секцию "hermes-agent" в .env.example) и повторите.');
  process.exit(1);
}

// 3. Запуск внешнего `hermes`.
const args = ['run', '--config', CONFIG_YAML];
console.log(`\u25b6 Запуск Hermes Agent:\n    hermes ${args.join(' ')}\n`);

const child = spawn('hermes', args, { stdio: 'inherit', shell: process.platform === 'win32' });

child.on('error', (err) => {
  if (err.code === 'ENOENT') {
    console.error('\n\u2717 Бинарник `hermes` не найден в PATH.');
    console.error('  Установите внешний Hermes Agent (см. tools/hermes-agent/README.md, раздел "Быстрый старт").');
    process.exit(127);
  }
  throw err;
});

child.on('exit', (code, signal) => {
  if (signal) {
    console.error(`\n\u2717 Hermes Agent завершён по сигналу ${signal}`);
    process.exit(1);
  }
  process.exit(code ?? 0);
});
