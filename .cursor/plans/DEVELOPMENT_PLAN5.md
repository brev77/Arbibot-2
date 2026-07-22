# Arbibot 2 — План 5: Hermes Agent — GLM 5.2 + Telegram

**Прогресс:** 8/8 ✅ | **Обновлено:** 2026-07-22 | **Детали шагов:** `.cursor/plans/hermes-agent-glm/`

> ✅ **H5-G-RUNTIME пройден (2026-07-22).** Все 6 runtime критериев PASS на Aéza Frankfurt.
> Был добавлен ретроспективно: шаги H5-A..H5-F помечены `done`, но ни один DoD не запускал
> бинарник `hermes` end-to-end (баг `hermes run` в `tools/run-hermes-agent.mjs` — см.
> `docs/lessons/hermes-agent-dod-failure.md`). При paper-deploy на Aéza сняты 3 блокера
> последовательно: (1) Telegram adapter — секция `platforms` в config.yaml; (2) китайский
> endpoint `open.bigmodel.cn` timeout из EU → `api.z.ai`; (3) GLM Coding Plan требует
> `/api/coding/paas/v4`, не `/api/paas/v4`. Agent обновлён до v0.19.0 (Quicksilver).
> Pipeline полностью работает: Operator → Telegram → Agent → GLM 5.2 → MCP → Gateway → ответ.

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
| `H5-G-RUNTIME` | Runtime DoD: реальный запуск agent + Telegram round-trip | **done** ✅ (6/6 PASS, v0.19.0, coding endpoint) | `hermes-agent-glm/H5-G-RUNTIME.md` |

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

### Runtime критерии (H5-G-RUNTIME) — ✅ ВСЕ ПРОЙДЕНЫ (2026-07-22)

> Эти критерии добавлены после обнаружения, что статических проверок недостаточно.
> Agent должен быть **реально запущен** и **реально ответить** через Telegram.
> Все 6 критериев PASS на Aéza Frankfurt (v0.19.0, GLM Coding Plan). См. [H5-G-RUNTIME.md](hermes-agent-glm/H5-G-RUNTIME.md).

- ✅ `hermes --version` отвечает (v0.19.0, Quicksilver).
- ✅ `hermes gateway run` запускается без ошибок и печатает "Gateway Starting".
- ✅ В логах adapter'а подтверждение подключения к Telegram (2 ESTAB соединения; цикл "Connecting attempt 1/8" устранён секцией `platforms` в config.yaml).
- ✅ Сообщение `/start`, отправленное оператором боту в Telegram, получает осмысленный ответ (через GLM 5.2 coding endpoint `api.z.ai/api/coding/paas/v4`).
- ✅ Cron-сводка (`HERMES_CRON_ENABLED=true`) — cron scheduler активен.
- ✅ `npm run run:hermes` не падает с `invalid choice: 'run'` (исправлено в `tools/run-hermes-agent.mjs`).

## Что НЕ делаем

- Не трогаем `apps/hermes-gateway` (чистый прокси) и `packages/hermes-mcp-server` (уже готов).
- Не делаем веб-страницу `/hermes/chat` (нужен внешний Telegram-агент, не веб-чат).
- Не добавляем Python-код в монорепо (агент остаётся внешним).
- Не зашиваем секреты — только env.

---
*v1.0 — 2026-07-16*
