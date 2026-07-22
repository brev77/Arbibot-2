# Arbibot 2 — План 5: Hermes Agent — GLM 5.2 + Telegram

**Прогресс:** 7/8 | **Обновлено:** 2026-07-22 | **Детали шагов:** `.cursor/plans/hermes-agent-glm/`

> ⚠️ **H5-G-RUNTIME добавлен ретроспективно (2026-07-22).** При первом deploy на Aéza
> выяснилось, что шаги H5-A..H5-F помечены `done`, но ни один DoD не запускал бинарник
> `hermes` end-to-end. Команда `hermes run` в `tools/run-hermes-agent.mjs` не существует
> в upstream hermes-agent — баг оставался незамеченным из-за отсутствия runtime-проверок.
> См. `docs/lessons/hermes-agent-dod-failure.md`. Шаги H5-A..H5-F формально `done`
> (артефакты на месте), но **Plan 5 в целом не завершён** до прохождения H5-G-RUNTIME.

## Контекст

Подключение внешнего **Hermes Agent** (NousResearch) к проекту с LLM = **GLM 5.2** (Zhipu/Z.AI) и личным **Telegram**-ботом оператора. Агент помогает разбираться в работе Arbibot-бота: объясняет архитектуру/термины, показывает текущее состояние, «следит за ботом» (периодические cron-сводки в Telegram).

**Предыстория:** Plan 3 (H3-C) подключил агента с `provider: nousresearch`, Telegram выключен. Папка `tools/hermes-agent/` содержит только конфиги (YAML + скиллы `.md`) — сам Python-код агента в монорепо **не входит** (внешний продукт). MCP Server (`packages/hermes-mcp-server`) и Hermes Gateway (`apps/hermes-gateway`) уже реализованы и в этом плане **не меняются**.

**Ключевое допущение:** GLM 5.2 подключается как OpenAI-совместимый провайдер (`provider: openai` + кастомный `base_url`), т.к. API Zhipu/Z.AI совместим с OpenAI Chat Completions.

## Целевой профиль

| Параметр | Значение |
|----------|----------|
| LLM | GLM 5.2 (Zhipu/Z.AI), `https://open.bigmodel.cn/api/paas/v4` |
| Провайдер в конфиге | `openai` (OpenAI-compat) + `base_url` |
| Messaging | Личный Telegram-бот (whitelist `OPERATOR_TELEGRAM_ID`) |
| Конфиг | `tools/hermes-agent/hermes-config.yaml` |
| MCP Server | `packages/hermes-mcp-server/` (без изменений) |
| Gateway | `apps/hermes-gateway/` порт 3020 (без изменений) |
| ADR | `docs/adr-hermes-agent-glm-telegram.md` |

## Статусы фаз

| step_id | Суть | status | details |
|---------|------|--------|---------|
| `H5-A-0-ADR` | ADR: GLM 5.2 + Telegram | done | `hermes-agent-glm/H5-A-0-ADR.md` |
| `H5-B-1-CONFIG` | Конфиг агента (provider→openai, +base_url, Telegram on) + mcp-config | done | `hermes-agent-glm/H5-B-1-CONFIG.md` |
| `H5-B-2-ENV` | Секция hermes-agent в `.env.example` | done | `hermes-agent-glm/H5-B-2-ENV.md` |
| `H5-C-2-SKILLS` | Скилл `explain-bot.md` | done | `hermes-agent-glm/H5-C-2-SKILLS.md` |
| `H5-D-3-SCRIPTS` | npm-скрипты + хелперы `.mjs` + README | done | `hermes-agent-glm/H5-D-3-SCRIPTS.md` |
| `H5-E-4-DOCKER` | Профиль `hermes-agent` в dev-compose | done | `hermes-agent-glm/H5-E-4-DOCKER.md` |
| `H5-F-5-DOCS` | Этот план + файлы шагов + AGENTS.md | done | `hermes-agent-glm/H5-F-5-DOCS.md` |
| `H5-G-RUNTIME` | ⚠️ Runtime DoD: реальный запуск agent + Telegram round-trip | **in-progress** (1-3,6 PASS; 4 подтверждён; нужен баланс Z.AI) | `hermes-agent-glm/H5-G-RUNTIME.md` |

## Dependency Graph

```
H5-A-0 → H5-B-1 ─┬─→ H5-B-2 ─→ H5-D-3 ─→ H5-E-4 ─→ H5-F-5
                  └─→ H5-C-2 ─────────────────────┘
```

## Workflow

1. Прочитать индекс (этот файл) — общая картина.
2. Прочитать `hermes-agent-glm/<step_id>.md` — детали шага.
3. Реализовать, обновить статус в этом файле.
4. Следующий шаг.

## Проверка (DoD)

### Статические критерии (H5-A..H5-F) — все ✓

- `npm run build:hermes-mcp` успешно собирает MCP-сервер.
- `npm run doctor:hermes-agent` при заполненном `.env` и запущенном gateway — все пункты ✓.
- `hermes-config.yaml` указывает на GLM 5.2 + Telegram enabled.
- `.env.example` содержит секцию hermes-agent с комментариями на русском.
- Новый скилл `explain-bot.md` соответствует формату остальных скиллов.
- `AGENTS.md` обновлён; ADR создан.

### Runtime критерии (H5-G-RUNTIME) — ⚠️ ТРЕБУЮТСЯ, статус blocked

> Эти критерии добавлены после обнаружения, что статических проверок недостаточно.
> Agent должен быть **реально запущен** и **реально ответить** через Telegram.

- `hermes --version` отвечает (бинарник установлен и в PATH).
- `hermes gateway run` запускается без ошибок и печатает "Gateway Starting".
- В логах adapter'а появляется подтверждение подключения к Telegram (НЕ "Connecting to Telegram (attempt 1/8)" в вечном цикле — а реальный success).
- Сообщение `/status` (или `/explain`), отправленное оператором боту в Telegram, получает осмысленный ответ в течение 60 сек.
- Cron-сводка (если `HERMES_CRON_ENABLED=true`) доходит до оператора в Telegram.
- `npm run run:hermes` не падает с `invalid choice: 'run'` (исправлено в `tools/run-hermes-agent.mjs`).

## Что НЕ делаем

- Не трогаем `apps/hermes-gateway` (чистый прокси) и `packages/hermes-mcp-server` (уже готов).
- Не делаем веб-страницу `/hermes/chat` (нужен внешний Telegram-агент, не веб-чат).
- Не добавляем Python-код в монорепо (агент остаётся внешним).
- Не зашиваем секреты — только env.

---
*v1.0 — 2026-07-16*
