# Lesson — DoD без behavioral verification: случай Hermes Agent (Plan 5)

**Дата:** 2026-07-22
**План:** Plan 5 (Hermes Agent → GLM 5.2 + Telegram), `.cursor/plans/DEVELOPMENT_PLAN5.md`
**Серьёзность:** средняя (agent не работает, но paper validation не блокируется)
**Тип:** process failure — Definition of Done без runtime-проверок

---

## TL;DR

Plan 5 был помечен **7/7 done**, хотя внешний бинарник `hermes` **никогда не запускался end-to-end**. Все критерии приёмки были статическими (существование файлов, `grep`, `node -c`, `docker compose config`). Когда агент впервые развернули на реальном сервере (Aéza, paper-deploy), выяснилось:

1. Команда `hermes run` в `tools/run-hermes-agent.mjs` **не существует** ни в одной upstream версии (0.13–0.19).
2. Telegram adapter зацикливается на "Connecting to Telegram (attempt 1/8)".
3. `doctor:hermes` (главный «верификатор») — read-only, не запускает агент.

**Урок:** DoD, проверяющий **артефакты** (файлы/конфиги), а не **поведение** (runtime), создаёт ложное ощущение готовности. Особенно опасно для интеграций с внешними зависимостями (бинарник, API, мессенджер), где сам факт «файл на месте» ничего не гарантирует.

---

## Что произошло — хронология

### 2026-07-16 — Plan 5 помечен done

7 шагов (H5-A..H5-F) реализованы. Каждый имеет «Test»-секцию:

| Шаг | Что проверялось | Тип проверки |
|---|---|---|
| H5-A-0-ADR | «Файл существует и содержит секции Decision/Fallback» | статическая |
| H5-B-1-CONFIG | `grep "glm-5.2" hermes-config.yaml` | статическая (grep) |
| H5-B-2-ENV | `grep -c "HERMES_LLM_API_KEY" .env.example` | статическая (grep) |
| H5-C-2-SKILLS | `test -f skills/explain-bot.md && echo OK` | статическая (файл) |
| H5-D-3-SCRIPTS | `node -c run-hermes-agent.mjs` | статическая (**синтаксис**, не запуск!) |
| H5-E-4-DOCKER | `docker compose ... config >/dev/null` | статическая (YAML-валидация) |
| H5-F-5-DOCS | `ls \| wc -l == 7`, `grep "Plan 5"` | статическая |

**Ни один шаг не запускал бинарник `hermes`.**

### 2026-07-22 — первый реальный deploy (Aéza Frankfurt)

При развёртывании paper-фазы:
- `hermes run --config ...` → `hermes: error: invalid choice: 'run'`
- После исправления на `hermes gateway run` → Telegram adapter зависает в цикле
- strace показал, что TLS handshake происходит, но application-логика не выходит из connecting-state

Если бы **хоть один** шаг Plan 5 требовал `npm run run:hermes` и проверки ответа Telegram, оба бага всплыли бы 2026-07-16, а не 2026-07-22.

---

## Корневые причины

### 1. Доверие к документации внешнего продукта

`tools/hermes-agent/README.md` и ADR описывают команду `hermes run --config ...`, основываясь на предположении, что такая подкоманда существует. Никто не сверил с реальным `hermes --help`. Поскольку agent — внешний продукт (NousResearch, не в монорепо), его CLI не покрыт тестами проекта.

### 2. DoD проверяет артефакты, а не поведение

Каждый «Test» отвечает на вопрос «файл/конфиг на месте?», а не «система работает?». Это особенно коварно, потому что артефакты (ADR, config, skills, scripts) **выглядят** как готовая система — легко поверить, что если файлы корректны, значит всё работает.

### 3. `doctor:hermes` создаёт ложное чувство безопасности

`tools/doctor-hermes-agent.mjs` помечен как «чек-лист готовности» и возвращает зелёный свет. Но в его собственном заголовке (стр. 11-12) написано:

> `Read-only: ничего не запускает, только делает GET-запросы к gateway.`

Он проверяет gateway (NestJS-приложение Arbibot), **не** agent (Python-бинарник). Секреты проверяются на непустоту, но не на валидность. Telegram/GLM API никогда не вызываются.

### 4. Нет CI smoke для hermes

- `.github/workflows/*.yml` — ноль упоминаний hermes
- Существующие smoke (`ci-bus-smoke.sh`, `ci-e2e-phase2*.sh`) покрывают bus/execution/risk — **не hermes**
- Регрессия осталась бы незамеченной при любом будущем изменении

### 5. `run-hermes-agent.mjs` проверен через `node -c`

Шаг H5-D-3-SCRIPTS использует `node -c run-hermes-agent.mjs` — это проверка **синтаксиса** (парсинг), а не **исполнения**. Команда `npm run run:hermes` добавлена в README как «ручное действие оператора», но не входила ни в один DoD.

---

## Антипаттерн — обобщённо

```
«Опасная зона»: интеграция с внешней системой (бинарник / API / мессенджер)
        ↓
DoD = статические проверки (файлы, конфиги, build, compose config)
        ↓
«Read-only» верификатор (doctor) — проверяет наши сервисы, не внешнюю интеграцию
        ↓
CI игнорирует эту интеграцию
        ↓
Единственный код, запускающий интеграцию (run-*.mjs), проверен синтаксически, не функционально
        ↓
Результат: «N/N done», интеграция никогда не работала
```

---

## Применимые правила (впредь)

### Правило 1: Behavioral verification для внешних интеграций

Для любой интеграции с внешней системой (внешний бинарник, сторонний API, мессенджер, blockchain RPC) **хотя бы один** шаг DoD должен проверять **runtime-поведение**, а не только артефакты.

Контрпример (плохо):
```
Test: grep "glm-5.2" hermes-config.yaml
```

Пример (хорошо):
```
Test: запустить agent, отправить /status в Telegram, получить ответ за 60 сек
```

### Правило 2: «Read-only верификатор» ≠ «интеграция работает»

Если верификационный инструмент (`doctor`, `health-check`) явно помечен «ничего не запускает» — это проверка **precondition**, не **behaviour**. DoD должен различать эти уровни и не принимать precondition за доказательство работы.

### Правило 3: Внешний CLI должен сверяться с `--help`

Если проект вызывает команду внешнего продукта (`hermes run`, `docker buildx`, `kubectl apply`), DoD должен включать шаг `hermes --help | grep run` (или эквивалент), подтверждающий, что подкоманда существует. Особенно когда product versioning не зафиксан.

### Правило 4: CI smoke для каждой интеграции

Каждая внешняя интеграция должна иметь smoke-тест в CI, даже если он использует mock (mock LLM, mock Telegram). Цель — поймать регрессии в **нашем** коде обвязки, даже если внешнюю систему нельзя протестировать в CI.

---

## Что исправлено в проекте (2026-07-22)

1. ✅ `tools/run-hermes-agent.mjs` — `hermes run` → `hermes gateway run`
2. ✅ `tools/hermes-agent/README.md` — обновлена команда + предупреждение
3. ✅ `infra/docker-compose.dev.yml` — обновлена command в профиле hermes-agent
4. ✅ `.cursor/plans/hermes-agent-glm/H5-E-4-DOCKER.md` — обновлена команда + комментарий
5. ✅ `.cursor/plans/DEVELOPMENT_PLAN5.md` — добавлен шаг H5-G-RUNTIME с runtime DoD, прогресс 7/7 → 7/8
6. ✅ `.cursor/plans/hermes-agent-glm/H5-G-RUNTIME.md` — детали runtime DoD
7. ⏳ `tools/ci-hermes-agent-smoke.sh` — TODO (CI smoke с mock LLM)

## Ссылки

- Plan: `.cursor/plans/DEVELOPMENT_PLAN5.md`
- Runtime DoD шаг: `.cursor/plans/hermes-agent-glm/H5-G-RUNTIME.md`
- ADR: `docs/adr-hermes-agent-glm-telegram.md`
- Deploy-отчёт: `docs/paper-deploy-aeza.md` (секция "Hermes stack")
- Расследование DoD: `.cursor/plans/hermes-agent-glm/H5-G-RUNTIME.md` (этот файл — обобщение)
