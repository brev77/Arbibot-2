---
description: Оркестратор ревью шага плана перед review_passed / done
---

Ты выполняешь **оркестратор ревью** для текущего шага плана разработки Arbibot 2. Цель — не дать перевести шаг в **`done`** без прохождения **`review_passed`** (см. lifecycle в `.cursor/plans/DEVELOPMENT_PLAN.md`).

## Вход

Пользователь может указать `step_id` в аргументе; иначе возьми активный шаг из контекста чата или единственный шаг в статусе `implemented` / `reviewing`.

$ARGUMENTS

## Workflow (выполняй по порядку)

### 1. План

- Прочитай активный план: **`.cursor/plans/DEVELOPMENT_PLAN.md`** (при нескольких `.md` в `.cursor/plans/` — уточни у пользователя или используй `DEVELOPMENT_PLAN.md`).
- Найди блок **`#### \`step_id\`** для целевого шага.
- Выпиши: **step_id**, **service**, **acceptance_criteria**, **changed_areas**, **review_required**, **status**.

### 2. Согласованность статуса

- Если статус не `implemented` или `reviewing`, опиши, что сначала нужно довести шаг до `implemented`, затем выставить `reviewing` перед финальным отчётом.
- Напомни правило: **`done` только после `review_passed`**.

### 3. Git diff

- Выполни сравнение с базовой веткой: **`git diff main...HEAD`** или **`git diff origin/main...HEAD`** (если ветки `main` нет — используй `master` или default branch репозитория; зафиксируй, какую ветку взял).
- Сопоставь изменённые пути с **changed_areas** шага; отметь расхождения.

### 4. Локальные проверки

Запускай из **корня репозитория** (Windows: PowerShell).

**Общие (монорепо):**

- `npm run build` — Turbo build по workspace
- `npm test` — тесты по workspace (зависит от `turbo.json`; падает — зафиксируй)

**Backend** (если в diff / `changed_areas` есть `apps/risk-service`, `packages/*` с серверным кодом, или `review_required` = `backend`):

- `npm run build -w @arbibot/risk-service`
- `npm run test -w @arbibot/risk-service`
- Отдельного `lint` в пакете может не быть — при необходимости: `npx tsc --noEmit -p apps/risk-service` (или путь к `tsconfig` пакета)

**Frontend** (если есть `apps/web` или `review_required` = `frontend`):

- `npm run build -w @arbibot/web`
- `npm run lint -w @arbibot/web` (Next.js 16: в проекте `eslint .` + `eslint.config.mjs`, не `next lint`)
- При отсутствии скрипта `typecheck`: `npx tsc --noEmit -p apps/web` (если есть подходящий tsconfig)

Если команда недоступна — явно напиши «команда не настроена» и что добавить в `package.json`.

### 5. Backend Review Agent

Если затронут backend по diff или **review_required** = `backend`:

- Примени инструкции из **`.cursor/skills/backend-review-agent/SKILL.md`** или команды **`/backend-review-agent`** к релевантным файлам и diff.
- Включи вывод в общий отчёт (секции Critical / Major / Minor / Architecture violations / Required fixes / Verdict).

### 6. Frontend Review Agent

Если затронут frontend или **review_required** = `frontend`:

- Примени **`.cursor/skills/frontend-review-agent/SKILL.md`** или **`/frontend-review-agent`**.
- Включи вывод в общий отчёт.

### 7. Architecture Guard Agent

**Всегда** (для любого шага):

- Примени **`.cursor/skills/architecture-guard-agent/SKILL.md`** или **`/architecture-guard-agent`** к изменениям и границам сервисов.
- Включи вывод в общий отчёт.

### 8. Единый отчёт

Собери один документ со структурой:

1. **Step** — step_id, service, статус до/после (предложение)
2. **Plan alignment** — соответствие acceptance_criteria и changed_areas
3. **Git & scope** — базовая ветка, кратко что в diff
4. **Checks** — build / test / lint / typecheck (что запускалось, pass/fail)
5. **Backend review** (если было) — сжатое резюме + Verdict
6. **Frontend review** (если было) — сжатое резюме + Verdict
7. **Architecture Guard** — сжатое резюме + Verdict
8. **Unified verdict** — список блокирующих (critical/major) и неблокирующих замечаний

### 9. Обновление статуса в плане

- Если есть **critical** или **major** из любого слоя ревью → предложи выставить **`review_failed`** (после выхода из `reviewing`) и перечисли required fixes.
- Если блокирующих нет → предложи: **`review_passed`**, затем после мержа/релиза шага — **`done`** (не объединять без явного подтверждения пользователя).

### 10. Явная инструкция пользователю

- Укажи точные правки в `.cursor/plans/DEVELOPMENT_PLAN.md` для поля **status** (строка `**status:** \`...\`` в блоке шага).
- Не выставляй `done`, пока пользователь не подтвердил, что **`review_passed`** зафиксирован.

## Политика

- Не одобряй `done` при открытых critical/major.
- Если не хватает контекста: **«Данных недостаточно: нужен <step_id / файл / ветка>»**.
