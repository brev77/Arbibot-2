# H5-D-3-SCRIPTS — npm-скрипты + хелперы + README

| Поле | Значение |
|------|----------|
| **depends_on** | `H5-B-2-ENV`, `H5-C-2-SKILLS` |
| **risk_level** | `low` (read-only утилиты) |
| **status** | done |

## Outputs
- `package.json` — скрипты `build:hermes-mcp`, `doctor:hermes`, `run:hermes`, `dev:stack:hermes-agent`.
- `tools/doctor-hermes-agent.mjs` — проверка готовности (MCP собран, env, gateway, ключ).
- `tools/run-hermes-agent.mjs` — обёртка запуска внешнего `hermes` с предпроверками.
- `tools/hermes-agent/README.md` — переписан под GLM 5.2 + Telegram (быстрый старт, env-таблица, устранение неполадок, Docker).

## Команды
- `npm run build:hermes-mcp` — собрать MCP-сервер.
- `npm run doctor:hermes` — чек-лист готовности (read-only, не запускает агент).
- `npm run run:hermes` — запуск агента.

## Edge Cases
- `run:hermes` падает с понятной ошибкой если бинарник `hermes` не в PATH (code 127).
- `doctor:hermes` маскирует секреты (печатает только префикс).
- Хелперы без зависимостей — только встроенные `fetch`/`fs`/`child_process`.

## Test
```bash
npm run build:hermes-mcp
node tools/doctor-hermes-agent.mjs   # exit 1 если env/gateway не готовы — это ожидаемо без .env
node -c tools/run-hermes-agent.mjs   # синтаксис OK
node -c tools/doctor-hermes-agent.mjs
```
