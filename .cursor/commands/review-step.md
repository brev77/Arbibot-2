---
description: Оркестратор ревью шага плана перед review_passed / done
---

Ты выполняешь **оркестратор ревью** для текущего шага плана разработки Arbibot 2. Цель — не дать перевести шаг в **`done`** без прохождения **`review_passed`** (см. lifecycle в плане).

## Планы и приоритет

1. **Активный план:** [`.cursor/plans/DEVELOPMENT_PLAN-DEX.md`](.cursor/plans/DEVELOPMENT_PLAN-DEX.md) — DEX-ветка (DEX-1 Single-Chain, DEX-2 Multi-Chain, DEX-DOC). **По умолчанию ревью проводится по этому плану.**
2. **Архивный план:** [`.cursor/plans/DEVELOPMENT_PLAN.md`](.cursor/plans/DEVELOPMENT_PLAN.md) — фазы 0–5, **выполнен**. **НЕ редактировать без явного запроса пользователя.** Если шаг принадлежит этому плану — пользователь должен явно указать это.

> **⚠️ Важно:** Если пользователь не указал план — используй `DEVELOPMENT_PLAN-DEX.md`. Если шаг `step_id` начинается с `DEX-` — это DEX-план. Если шаг начинается с `P1-`, `P2-`, `P3-` и т.д. — это архивный план (потребуется явное подтверждение пользователя).

## Вход

Пользователь может указать `step_id` в аргументе; иначе возьми активный шаг из контекста чата или единственный шаг в статусе `implemented` / `reviewing`.

$ARGUMENTS

## Workflow (выполняй по порядку)

### 1. План

- Прочитай активный план (по умолчанию **`.cursor/plans/DEVELOPMENT_PLAN-DEX.md`**).
- Найди блок **`#### \`step_id\`** для целевого шага.
- Выпиши: **step_id**, **service**, **acceptance_criteria**, **changed_areas**, **review_required**, **risk_level**, **depends_on**, **status**.

### 2. Согласованность статуса

- Если статус не `implemented` или `reviewing`, опиши, что сначала нужно довести шаг до `implemented`, затем выставить `reviewing` перед финальным отчётом.
- Напомни правило: **`done` только после `review_passed`**.
- Проверь, что все **depends_on** шаги имеют статус `done` (если нет — предупреди).

### 3. Git diff

- Выполни сравнение с базовой веткой: **`git diff main...HEAD`** или **`git diff origin/main...HEAD`** (если ветки `main` нет — используй `master` или default branch репозитория; зафиксируй, какую ветку взял).
- Сопоставь изменённые пути с **changed_areas** шага; отметь расхождения.

### 4. Локальные проверки

Запускай из **корня репозитория**.

**Общие (монорепо):**

- `npm run build` — Turbo build по workspace
- `npm run test` — тесты по workspace (зависит от `turbo.json`; падает — зафиксируй)

**Backend** (если в diff / `changed_areas` есть `apps/*`, `packages/*` с серверным кодом, или `review_required` содержит `backend`):

- `npm run build -w @arbibot/<service-name>`
- `npm run test -w @arbibot/<service-name>`
- При необходимости: `npx tsc --noEmit -p apps/<service-name>/tsconfig.build.json`

**Frontend** (если есть `apps/web` или `review_required` = `frontend`):

- `npm run build -w @arbibot/web`
- `npm run lint -w @arbibot/web`

Если команда недоступна — явно напиши «команда не настроена» и что добавить в `package.json`.

### 5. Architecture Guard Agent (ОБЯЗАТЕЛЬНО для любого шага)

**Всегда** — для каждого шага без исключений:

- Загрузи и примени скилл **`.cursor/skills/architecture-guard-agent/SKILL.md`**.
- Проверь: single-writer, reservation-first, state machine transitions, outbox/inbox, paper/live isolation, service boundaries, DEX-specific invariants (если шаг DEX).
- Для DEX-шагов дополнительно проверь:
  - Кошелёк — EOA-only, без AA/relayer
  - Ключи — шифрование at rest, audit при использовании
  - Gas policy — maxFeePerGas enforcement
  - On-chain entities — single-writer boundaries (`on_chain_transactions`, `wallet_states`, `dex_pools`, `approvals`)
  - VenueAdapter — контракт согласован с существующим интерфейсом
- Включи вывод в общий отчёт (секция Architecture Guard).

### 6. Backend Review Agent (если затронут backend)

Если затронут backend по diff или **review_required** содержит `backend`:

- Загрузи и примени скилл **`.cursor/skills/backend-review-agent/SKILL.md`**.
- Для DEX-шагов дополнительно проверь:
  - ethers.js v6 использование без `any`
  - RPC failover и health checks
  - Gas estimation и EIP-1559 корректность
  - Slippage protection и minimumAmountOut
  - Token approve idempotency
  - On-chain transaction tracking
- Включи вывод в общий отчёт (секция Backend Review).

### 7. Frontend Review Agent (если затронут frontend)

Если затронут frontend или **review_required** содержит `frontend`:

- Загрузи и примени скилл **`.cursor/skills/frontend-review-agent/SKILL.md`**.
- Для DEX-шагов дополнительно проверь:
  - DEX filters panel в `/settings`
  - Wallet management UI (если есть)
  - Health/degradation banners для DEX
  - On-chain transaction display в `/execution`
- Включи вывод в общий отчёт (секция Frontend Review).

### 8. Единый отчёт

Собери один документ со структурой:

1. **Step** — step_id, service, plan (DEX/archive), статус до/после (предложение)
2. **Plan alignment** — соответствие acceptance_criteria и changed_areas; depends_on статусы
3. **Git & scope** — базовая ветка, кратко что в diff
4. **Checks** — build / test / lint / typecheck (что запускалось, pass/fail)
5. **Architecture Guard** (всегда) — сжатое резюме + Verdict
6. **Backend review** (если было) — сжатое резюме + Verdict
7. **Frontend review** (если было) — сжатое резюме + Verdict
8. **Unified verdict** — список блокирующих (critical/major) и неблокирующих замечаний

### 9. Обновление статуса в плане

- Если есть **critical** или **major** из любого слоя ревью → предложи выставить **`review_failed`** и перечисли required fixes.
- Если блокирующих нет → предложи: **`review_passed`**, затем после мержа/релиза шага — **`done`**.
- **Не выставляй `done`**, пока пользователь не подтвердил, что **`review_passed`** зафиксирован.
- Добавь `review_notes`, `review_passed_date` в блок шага.

### 10. Явная инструкция пользователю

- Укажи точные правки в файле плана для поля **status** (строка `**status:** \`...\`` в блоке шага).
- Укажи какие `review_action_items` остались открытыми.
- Если есть технический долг (missing tests, TODOs) — зафиксируй в `review_action_items`.

## Скиллы (обязательны к использованию)

| Скилл | Когда | Путь |
|-------|-------|------|
| **Architecture Guard Agent** | Всегда, для любого шага | `.cursor/skills/architecture-guard-agent/SKILL.md` |
| **Backend Review Agent** | Если `review_required` содержит `backend` или diff затрагивает `apps/*`, `packages/*` | `.cursor/skills/backend-review-agent/SKILL.md` |
| **Frontend Review Agent** | Если `review_required` содержит `frontend` или diff затрагивает `apps/web` | `.cursor/skills/frontend-review-agent/SKILL.md` |
| **Git Workflow Agent** | Перед коммитом изменений, при подготовке PR, при разрешении конфликтов | `.cursor/skills/git-workflow-agent/SKILL.md` |

## Политика

- Не одобряй `done` при открытых critical/major.
- Не редактируй архивный план `DEVELOPMENT_PLAN.md` без явного запроса.
- Если не хватает контекста: **«Данных недостаточно: нужен <step_id / файл / ветка>»**.
- Все `review_action_items` с невыполненными чекбоксами — блокирующие до исправления или явного согласования.