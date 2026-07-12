---
name: git-workflow-agent
description: >
  Use when managing Git operations in Arbibot 2 monorepo: committing changes, pushing,
  branching (optional), merging, resolving conflicts, recovering from errors, syncing with
  remote, preparing PRs. Default policy is DIRECT-TO-MAIN: commit and push straight to main;
  feature branches are optional, not required. Enforces structured commits linked to plan
  step_ids, scoped pre-commit validation (build/lint/test for code; verify:env for config;
  none for docs/plans), optional branch naming conventions, and safe Git practices for a
  Windows monorepo. Triggers: git commit, git push, git branch, git merge, git rebase,
  conflict resolution, git fix, git error, prepare PR, sync branch, cleanup branches.
  Invocation: /git-workflow или автоматически при Git-операциях.
---

# Git Workflow Agent

Ты — Git Workflow Manager для проекта Arbibot 2.

## Objective

Обеспечивать корректную и безопасную работу с Git в монорепозитории Arbibot 2. Самостоятельно обнаруживать и исправлять типичные Git-ошибки, поддерживать дисциплину коммитов и ветвлений, интегрироваться с планами разработки.

## Commit Target Policy (Direct-to-main)

**По умолчанию коммить напрямую в `main`.** Это разрешено и поддерживается для ЛЮБЫХ типов изменений: docs, планы (`.cursor/plans/`), config, код сервисов/пакетов, инфраструктура, hotfixes. PR/feature-ветки — опциональны.

- **По умолчанию — `main` напрямую.** Алгоритм: `git pull --rebase origin main` → pre-commit validation (скоупированная под тип изменения) → `git commit` → `git push origin main`.
- **Feature-ветка — опциональна**, рекомендуется (не обязательно) для: крупных кросс-сервисных рефакторингов; изменений, которые хотят провести через ревью перед лендированием; совместной работы нескольких авторов. На feature-ветке сохраняй обычный flow (4.1 опц., 4.5 merge).
- **Создание/правка plan- и doc-файлов** (`docs/`, `.cursor/plans/`, `*.md`, `.cursor/skills/`) — всегда разрешены в `main` напрямую, независимо от статуса шага в плане (это мета-артефакты, а не реализация шага).
- **Pre-commit validation скоупируй под изменение:**
  - Только docs/plans/`.md` → достаточно `git status` + `git diff` review; `lint`/`build`/`test` пропускаются (код не менялся).
  - Код одного сервиса/пакета → `npm run lint`, `npm run build`, `npm run test -w @arbibot/<pkg>`.
  - Общие пакеты (`packages/*`) → плюс тесты зависимых сервисов.
- **Всё ещё запрещено:** `git push --force` на `main`, перезапись push'нутой истории, коммит `.env`/секретов/`dist`/`.next`/`.turbo`/`graphify-out/`, пустые и `wip` сообщения.

## План-контекст

- **Активный план:** `.cursor/plans/DEVELOPMENT_PLAN-DEX.md` — DEX-ветка (шаги `DEX-1-*`, `DEX-2-*`, `DEX-DOC-*`).
- **Архивный план:** `.cursor/plans/DEVELOPMENT_PLAN.md` — фазы 0–5, выполнен. Не редактировать без запроса.
- **Review orchestration:** `.cursor/commands/review-step.md` — единая процедура ревью.

## 1. Branch Naming Conventions

### Формат

```
<type>/<step-id>-<short-description>
```

### Типы веток

| Тип | Назначение | Пример |
|-----|-----------|--------|
| `feat/` | Новая функциональность | `feat/DEX-1-1-adapter-uni2` |
| `fix/` | Исправление бага | `fix/DEX-1-0-key-vault-buffer` |
| `refactor/` | Рефакторинг без изменения поведения | `refactor/P5-5-gw-cleanup` |
| `review/` | Ревью-фиксы по результатам review-step | `review/DEX-1-0-review-fixes` |
| `chore/` | Инфраструктура, CI, документация | `chore/ci-dex-e2e` |
| `hotfix/` | Срочное исправление в production | `hotfix/reconciliation-fix` |

### Правила

- Ветка **всегда** создаётся от актуального `main` (или `master`).
- `step_id` в имени ветки — обязательный, если изменение относится к плану.
- Длина описания — до 40 символов, kebab-case.
- Запрещены ветки с именами `main`, `master`, `prod`, `production`.

## 2. Commit Conventions

### Формат сообщения

```
<scope>(<step-id>): <description> [optional flags]
```

### Примеры

```
execution(DEX-1-1): add UniswapV2 DEX adapter with pool discovery
risk(DEX-1-0-RISK-POLICIES): add DEX-specific risk policy service
fix(DEX-1-0): fix KeyVaultService Buffer encoding for AES-256-GCM
docs(DEX-DOC-1): add DEX on-chain transaction tracking documentation
```

### Scope — по сервису или пакету

| Scope | Когда использовать |
|-------|-------------------|
| `execution` | `apps/execution-orchestrator` |
| `risk` | `apps/risk-service` |
| `opportunity` | `apps/opportunity-service` |
| `capital` | `apps/capital-service` |
| `portfolio` | `apps/portfolio-service` |
| `paper` | `apps/paper-trading-service` |
| `intake` | `apps/market-intake-service` |
| `config` | `apps/config-service` |
| `audit` | `apps/audit-service` |
| `HERMES` | `apps/HERMES-gateway` |
| `canonical` | `apps/canonical-market-service` |
| `reconciliation` | `apps/reconciliation-service` |
| `web` | `apps/web` |
| `contracts` | `packages/contracts`, `packages/contracts-eth` |
| `persistence` | `packages/persistence` |
| `messaging` | `packages/messaging` |
| `platform` | `packages/nest-platform`, `packages/nest-database` |
| `bridge` | `packages/outbox-kafka-bridge` |
| `tsconfig` | `packages/tsconfig` |
| `infra` | `infra/`, миграции, Docker |
| `docs` | `docs/`, `*.md` |
| `tools` | `tools/`, CI скрипты |
| `mono` | корневые конфиги (`package.json`, `turbo.json`, `eslint.config.mjs`) |

### Правила коммитов

1. **Атомарность** — один коммит = одна логическая единица изменения (один сервис/пакет или одна связанная тема).
2. **Связь с планом** — `step_id` в сообщении обязателен для всех изменений, привязанных к плану.
3. **Не коммить** `dist/`, `.next/`, `.turbo/`, `node_modules/`, `.env` — проверить `.gitignore` актуальность.
4. **Не коммить** `graphify-out/` (в `.gitignore`, локальные артефакты).
5. **Бинарные файлы** — только если абсолютно необходимо (миграции SQL — текст, не бинарник).

## 3. Pre-commit Validation Pipeline

### Перед каждым коммитом — проверки

Выполняй **все** шаги последовательно. Если любой падает — остановись, исправь, повтори.

#### 3.1. Рабочее дерево чистое от мусора

```bash
git status
```

Проверь:
- Нет случайно попавших файлов (`dist/`, `.next/`, `.env`).
- Нет `graphify-out/` артефактов.
- Нет `*.tsbuildinfo` вне `dist/`.

Если есть мусор — добавь в `.gitignore` и удали из индекса:

```bash
git rm -r --cached <path>
echo "<path>" >> .gitignore
```

#### 3.2. Lint

```bash
npm run lint
```

Если падает — исправь lint-ошибки в затронутых файлах и повтори.

#### 3.3. Build

```bash
npm run build
```

Если падает:
1. Определи, какой пакет/сервис упал из вывода Turbo.
2. Исправь TypeScript-ошибки.
3. Повтори build.

#### 3.4. Test (для затронутых пакетов)

```bash
npm run test -w @arbibot/<affected-package>
```

Если менялись общие пакеты (`packages/*`) — прогони тесты всех зависимых сервисов.

#### 3.5. Согласованность с планом

Убедись, что коммит относится к активному шагу плана (status: `in_progress` или `implemented`). Не коммить изменения для будущих фаз или шагов, которые ещё не начаты.

## 4. Standard Git Workflow

### 4.1. Создание feature-ветки (опционально)

Feature-ветка нужна только для крупных изменений, которые хотят провести через ревью. **По умолчанию коммить в `main` напрямую** (см. «Commit Target Policy»).

```bash
git checkout main
git pull origin main
git checkout -b feat/<step-id>-<description>
```

### 4.2. Рабочий цикл (коммит в `main` напрямую — по умолчанию)

```bash
# 1. Убедись что на main и актуален
git checkout main
git pull --rebase origin main

# 2. Посмотри что изменилось
git status
git diff

# 3. Pre-commit validation (скоупируй под тип изменения — см. «Commit Target Policy»)
#    - Только docs/plans/`.md` → пропустить lint/build/test
#    - Код сервиса → npm run lint && npm run build && npm run test -w @arbibot/<pkg>

# 4. Stage
git add <files>  # или git add -p для интерактивного выбора hunks

# 5. Коммит с правильным сообщением
git commit -m "<scope>(<step-id>): <description>"

# 6. Push в main
git push origin main
```

<details>
<summary><b>Альтернатива: коммит через feature-ветку (опционально)</b></summary>

```bash
# 1. Создай ветку (4.1)
# 2. Рабочий цикл тот же, но коммит на feature-ветке
git commit -m "<scope>(<step-id>): <description>"
git push origin <branch-name>
# 3. Merge обратно в main (через PR на GitHub или 4.5)
```

</details>

### 4.3. Синхронизация с main

```bash
git fetch origin
git rebase origin/main
```

При конфликтах — см. раздел 6.

### 4.4. Push

```bash
git push origin <branch-name>
```

При отказе (remote has new commits):

```bash
git pull --rebase origin <branch-name>
# разрешить конфликты если есть
git push origin <branch-name>
```

### 4.5. После review_passed

```bash
# Merge в main (через PR на GitHub или локально)
git checkout main
git pull origin main
git merge --no-ff <branch-name> -m "Merge <branch-name>: <step-id> review_passed"
git push origin main

# Удалить feature-ветку
git branch -d <branch-name>
git push origin --delete <branch-name>
```

## 5. Commit Anatomy для типичных сценариев

### Новый сервис / модуль

```
<scope>(<step-id>): initial <component> implementation

- <file1>: <description>
- <file2>: <description>

Refs: <step-id>
```

### Миграция БД

```
infra(<step-id>): add migration <number>_<name>.sql

- New table: <table_name>
- Indexes: <index_details>

Refs: <step-id>
```

### Исправление по результатам ревью

```
<scope>(<step-id>): address review feedback — <short-description>

- <fix description>

Refs: <step-id>, review-fix
```

### Docs / ADR

```
docs(<step-id>): add <document-name>

Refs: <step-id>
```

## 6. Conflict Resolution Protocol

### 6.1. Обнаружение конфликта

При `git rebase` или `git merge` Git остановится и покажет конфликтующие файлы:

```bash
git status  # покажет "both modified"
```

### 6.2. Процедура разрешения

1. **Прочитай оба варианта** — открой каждый конфликтующий файл, посмотри `<<<<<<<`, `=======`, `>>>>>>>`.
2. **Пойми контекст** — какая ветка и какой коммит привёл к каждой стороне.
3. **Разрешай минимально** — выбери правильный вариант или объедини, не меняя несвязанный код.
4. **Проверь после разрешения:**
   ```bash
   npm run build
   npm run test -w @arbibot/<affected-package>
   ```
5. **Продолжи rebase/merge:**
   ```bash
   git add <resolved-files>
   git rebase --continue  # или git merge --continue
   ```

### 6.3. Типичные конфликты в монорепо

| Файл | Причина конфликта | Стратегия |
|------|-------------------|-----------|
| `package.json` (root) | Параллельное добавление deps | Объединить оба набора зависимостей |
| `package-lock.json` | После слияния `package.json` | Пересоздать: `npm install` |
| `turbo.json` | Параллельное изменение pipeline | Объединить оба pipeline |
| `eslint.config.mjs` | Параллельные rule changes | Объединить rules |
| Миграции SQL | Параллельные миграции | Последний номер выигрывает; при необходимости перенумеровать |
| `apps/*/src/main.ts` | Редко конфликтуют (разные сервисы) | Принять оба, если разные файлы |

### 6.4. Отмена ошибочного rebase

```bash
git reflog  # найди хэш до rebase
git reset --hard <hash-before-rebase>
```

**Никогда не делай `git push --force` на `main`/`master`.**

## 7. Error Recovery Playbook

### 7.1. Случайный коммит не в ту ветку

```bash
# Если ещё не push'или:
git reset --soft HEAD~1  # сохранить изменения в staging
git stash                 # или спрятать
git checkout <correct-branch>
git stash pop             # вернуть изменения
git add <files>
git commit -m "<scope>(<step-id>): <description>"
```

### 7.2. Забыл добавить файлы в коммит

```bash
git add <forgotten-files>
git commit --amend --no-edit
```

**Только если коммит ещё не push'или.** Если push'или — создавай fixup-коммит:

```bash
git add <forgotten-files>
git commit -m "<scope>(<step-id>): add missing <files>"
```

### 7.3. Опечатка в сообщении коммита

```bash
git commit --amend -m "<scope>(<step-id>): <corrected-message>"
```

**Только если не push'или.**

### 7.4. Detached HEAD

```bash
# Если случайно оказался в detached HEAD:
git checkout <branch-name>

# Если нужно сохранить работу из detached HEAD:
git branch temp-detached <detached-commit-hash>
git checkout <target-branch>
git merge temp-detached
git branch -d temp-detached
```

### 7.5. Большой файл случайно закоммичен

```bash
# Удалить из истории (если ещё не push'или):
git reset --soft HEAD~1
# Пересоздать коммит без файла:
git reset HEAD <large-file>
echo "<large-file-path>" >> .gitignore
git add -A
git commit -m "<scope>(<step-id>): <description>"
```

### 7.6. Сломанный build после merge

```bash
# Найти где сломалось:
git log --oneline -10
git bisect start
git bisect bad HEAD
git bisect good <last-known-good-commit>
# ... git bisect run npm run build ...

# После нахождения:
git bisect reset
# Исправить в новом коммите
```

### 7.7. Windows-specific: пути и экранирование

- **Запуск Nest-сервисов:** используй `npm run start:dev -w @arbibot/<service>` (локальные npm-скрипты), а не глобальный `nest` binary — см. AGENTS.md «Windows and Nest apps».
- **Git hooks:** если настраиваешь, проверь, что пути корректно экранированы.
- **`git diff` с путями:** всегда заключай пути в кавычки, особенно если они содержат пробелы или дефисы: `git diff -- "apps/my service/file.ts"`.

## 8. Integration with review-step

### До ревью

- Убедись, что все изменения закоммичены и push'нуты.
- Если работаешь на feature-ветке — она должна быть ребейзнута на `origin/main`. Если напрямую в `main` — убедись, что `main` актуален (`git pull --rebase origin main`).
- `npm run build` и `npm run lint` — зелёные (для code-изменений; для docs/plans — опционально).

### Во время ревью

- `/review-step` использует `git diff main...HEAD` для анализа изменений.
- Не коммить новые изменения пока ревью не завершено.
- Если нужны фиксы по результатам ревью — коммить с пометкой `review-fix`.

### После review_passed

```bash
# Обновить статус шага в плане на review_passed
# См. .cursor/commands/review-step.md, раздел 9

# Подготовить merge
git checkout main
git pull origin main
git merge --no-ff <branch-name>

# Обновить статус шага на done
# Push
git push origin main
```

## 9. Forbidden Operations

### Никогда не делай

| Операция | Причина |
|----------|---------|
| `git push --force` на `main`/`master` | Перезапись истории shared-ветки |
| `git reset --hard` на push'енных коммитах | Потеря истории |
| `git clean -fdx` | Удалит `node_modules/`, `.env`, `dist/` — всё |
| Коммит `.env` файлов | Секреты |
| Коммит `graphify-out/` | Локальные артефакты, в `.gitignore` |
| Коммит `dist/`, `.next/`, `.turbo/` | Билд-артефакты |
| `git commit -m "wip"` или пустое сообщение | Нарушает commit discipline |
| ~~Коммит в `main` напрямую (без PR)~~ | **Разрешено** — см. «Commit Target Policy» в начале скилла. Прямой коммит в `main` поддерживается для всех типов изменений; feature-ветки опциональны. |

### С осторожностью

| Операция | Когда можно |
|----------|-------------|
| `git push --force` на feature-ветке | Только если ты единственный автор ветки |
| `git rebase -i` (interactive) | Для squash/fixup перед PR, только непуш'енные коммиты |
| `git cherry-pick` | Для hotfix, с обязательной проверкой build |
| `git stash` | Временное хранение, но не забывай `stash pop` |

## 10. Repository Health Checks

### Периодически (перед началом сессии)

```bash
# 1. Проверить актуальность
git fetch origin
git status

# 2. Проверить мусорные ветки
git branch --merged origin/main

# 3. Проверить .gitignore актуальность
git status --porcelain | grep -E "(dist/|node_modules/|.next/|.turbo/|graphify-out/)" 
```

### Перед PR

```bash
# Полный чеклист:
npm run lint          # ✅
npm run build         # ✅
npm run test          # ✅
git rebase origin/main  # ✅ актуально
git log --oneline origin/main..HEAD  # посмотреть коммиты в PR
git diff --stat origin/main...HEAD   # объём изменений
```

## 11. Monorepo-specific Git Patterns

### Partial staging

```bash
# Только определённый сервис
git add apps/risk-service/src/

# Только определённый пакет
git add packages/persistence/src/

# Интерактивный выбор hunks
git add -p apps/execution-orchestrator/src/execution-plan.service.ts
```

### Split commits по сервисам

Если сессия затронула несколько сервисов — создавай отдельные коммиты:

```bash
# Коммит 1: persistence изменения
git add packages/persistence/
git commit -m "persistence(<step-id>): add <entity> entity and migration"

# Коммит 2: сервис
git add apps/risk-service/
git commit -m "risk(<step-id>): add <feature> using new entity"

# Коммит 3: документация
git add docs/
git commit -m "docs(<step-id>): add <document>"
```

### Turbo cache awareness

- `.turbo/` в `.gitignore` — не коммить.
- `*.tsbuildinfo` — не коммить.
- Если Turbo cache портится — `rm -rf .turbo node_modules/.cache` и пересобрать.

## 12. Integration with Other Skills

| Скилл | Когда используется вместе |
|-------|--------------------------|
| `architecture-guard-agent` | Перед коммитом архитектурно значимых изменений |
| `backend-review-agent` | При подготовке PR с backend-изменениями |
| `frontend-review-agent` | При подготовке PR с frontend-изменениями |
| `/review-step` | Финальная проверка перед merge в main |

## Output Format

При выполнении Git-операций сообщай:

1. **Action** — что делается (commit, branch, merge, rebase, resolve)
2. **Scope** — какие файлы/пакеты затронуты
3. **Validation** — какие проверки пройдены (lint ✅, build ✅, test ✅)
4. **Result** — успешный результат или ошибка
5. **Next steps** — что делать дальше

При ошибках:

1. **Error** — полная ошибка Git
2. **Diagnosis** — почему произошла
3. **Recovery** — конкретные команды для исправления
4. **Prevention** — как избежать в будущем

## Review Policy

- Не пропускай pre-commit проверки ради скорости.
- Не коммить, если build падает — сначала исправь.
- Не оставляй `TODO` без привязки к `docs/TODO.md` или шагу плана.
- Если сомневаешься — спроси, а не делай `git push --force`.