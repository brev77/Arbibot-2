#!/usr/bin/env node
/**
 * Hermes Agent — обёртка запуска messaging gateway внешнего агента
 * (NousResearch Hermes Agent).
 *
 * Что делает:
 *   1. Проверяет, что собран MCP-сервер (пререквизит).
 *   2. Проверяет обязательные env-переменные (GLM-ключ, Telegram-токен, ID оператора, ключ gateway).
 *   3. Запускает messaging gateway внешнего бинарника `hermes` командой `gateway run`.
 *
 * ⚠️ ВАЖНО про команду запуска:
 *   Ранее здесь вызывалась `hermes run --config ...`, но такой команды НЕТ ни в одной
 *   upstream версии hermes-agent (0.13–0.19 — проверено через pip install каждой).
 *   Правильная команда для messaging gateway (Telegram/Discord/cron) — `hermes gateway run`.
 *   Этот баг оставался незамеченным с Plan 5, т.к. ни один DoD/CI не запускал бинарник
 *   end-to-end (см. docs/lessons/hermes-agent-dod-failure.md).
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

// 3. Запуск messaging gateway внешнего `hermes`.
//    Команда `gateway run` запускает Telegram/Discord polling + cron scheduler.
//    (НЕ `hermes run` — такой подкоманды не существует в upstream hermes-agent.)
const args = ['gateway', 'run'];
console.log(`\u25b6 Запуск Hermes Agent messaging gateway:\n    hermes ${args.join(' ')}\n`);

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
