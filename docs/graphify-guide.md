# Graphify — Руководство разработчика Arbibot 2

**Версия:** 1.0  
**Дата:** 2026-05-21  
**Текущее состояние графа:** 1694 nodes, 1691 edges, 417 communities (498 файлов)

---

## Что такое Graphify

[Graphify](https://github.com/safishamsi/graphify) — это инструмент для построения **knowledge graph** кодовой базы. Он анализирует AST TypeScript/Python файлов и строит граф зависимостей между модулями, сервисами, сущностями и пакетами.

В Arbibot 2 Graphify используется для:
- **Проверки границ сервисов** — кто читает/пишет данную сущность
- **Валидации single-writer** — только один сервис владеет мутациями сущности
- **Обнаружения god nodes** — пакетов с аномально большим количеством зависимостей
- **Выявления неожиданных зависимостей** — кросс-сервисных связей, нарушающих изоляцию

---

## Установка

```bash
# Однократная установка (локально, не в проект):
pip install graphifyy

# Установка Cursor-интеграции (создаёт .cursor/rules/graphify.mdc):
python -m graphify cursor install
```

---

## Команды

### npm-скрипты (рекомендуемый способ)

```bash
# Перестроить граф после изменений кода:
npm run graphify:rebuild

# Выполнить query к графу:
npm run graphify:query -- "Which services write to ExecutionPlan?"

# Показать отчёт:
npm run graphify:report
```

### Прямые команды (Python)

```bash
# AST-only rebuild (быстрый, ~30 сек):
py -3 -c "from graphify.watch import _rebuild_code; from pathlib import Path; _rebuild_code(Path('.'))"

# Query:
py -3 -m graphify query "ваш вопрос" --graph graphify-out/graph.json

# Полный rebuild (включая docs, markdown, images):
# В Cursor: /graphify . --update
```

---

## Типичные сценарии использования

### 1. Проверка single-writer перед изменением

```bash
# Кто пишет в ExecutionPlan?
npm run graphify:query -- "Which services write to ExecutionPlan?"
# Ожидание: только execution-orchestrator

# Кто владеет RiskDecision?
npm run graphify:query -- "Who writes RiskDecision?"
# Ожидание: только risk-service
```

### 2. Проверка shared-package зависимостей

```bash
# Что зависит от @arbibot/persistence?
npm run graphify:query -- "What depends on @arbibot/persistence?"

# Есть ли god nodes?
npm run graphify:query -- "Which packages have the most dependents?"
```

### 3. Анализ границ сервисов

```bash
# Какие сервисы зависят от execution-orchestrator?
npm run graphify:query -- "What services depend on execution-orchestrator?"

# Есть ли циклические зависимости?
npm run graphify:query -- "Are there circular dependencies between services?"
```

### 4. Перед architecture review

```bash
# Полная диагностика:
npm run graphify:rebuild
cat graphify-out/GRAPH_REPORT.md
```

### 5. Перед деплоем

```bash
# Обновить граф и проверить отчёт:
npm run graphify:rebuild
npm run graphify:report
```

---

## Автоматическое поддержание графа

Граф обновляется **автоматически** в трёх местах:

### 1. Git hooks (после каждого коммита / pull)

Хуки установлены через `npm run prepare` (запускается при `npm ci`):

```
.githooks/post-commit   → rebuild после git commit
.githooks/post-merge    → rebuild после git pull
```

Rebuild запускается **в фоне** (`&`) и не блокирует git операции.

### 2. CI (GitHub Actions)

Job `graphify-check` перестраивает граф на каждый push в main/master.
Артефакт `GRAPH_REPORT.md` доступен для скачивания (7 дней).

### 3. Ручной rebuild (при необходимости)

```bash
npm run graphify:rebuild
```

### Когда нужен ручной rebuild

Граф всегда актуален после commit/pull, но ручной rebuild полезен:
- Перед architecture review (убедиться в свежести)
- После больших незакоммиченных изменений
- При отладке зависимостей в процессе разработки

## Когда обновлять граф

| Ситуация | Команда |
|----------|---------|
| После изменений в `apps/*` или `packages/*` | `npm run graphify:rebuild` |
| Перед `/review-step` | `npm run graphify:rebuild` |
| Перед architecture review | `npm run graphify:rebuild` + `GRAPH_REPORT.md` |
| После рефакторинга shared packages | `npm run graphify:rebuild` |
| После изменений документации | `/graphify . --update` (в Cursor) |
| Перед деплоем | `npm run graphify:rebuild` |

---

## Интерпретация GRAPH_REPORT.md

Граф состоит из:

- **Nodes** (узлы) — файлы, классы, функции, модули
- **Edges** (рёбра) — зависимости между узлами (import, вызов, наследование)
- **Communities** (сообщества) — логические группы связанных узлов

### На что обращать внимание:

1. **God nodes** — узлы с аномально большим количеством связей (>50 edges). Часто указывают на необходимость рефакторинга.

2. **Unexpected cross-service edges** — зависимости между сервисами, которые не должны знать друг о друге напрямую (например, `paper-trading-service` → `execution-orchestrator`).

3. **Shared package hotspots** — `@arbibot/persistence` и `@arbibot/contracts` — ожидаемо имеют много зависимостей, но рост должен быть контролируемым.

4. **Community drift** — если сообщество сервиса «размыто» по нескольким communities, это признак нарушенной cohesion.

---

## CI-интеграция

GitHub Actions содержит job `graphify-check`:
- Запускается после `build` job
- Перестраивает граф и публикует `GRAPH_REPORT.md` как артефакт
- **Non-blocking** (`continue-on-error: true`) — не блокирует CI
- Артефакт хранится 7 дней

---

## Интеграция с Cursor

### Правило `.cursor/rules/graphify.mdc`

Автоматически загружается в контекст Cursor. Содержит инструкции:
- Перед ответами на архитектурные вопросы — читать `GRAPH_REPORT.md`
- После code changes — запускать `_rebuild_code`
- Использовать query для проверок

### Skills

Graphify дополняет Cursor skills:
- **architecture-guard-agent** — использует граф для проверки границ
- **backend-review-agent** — проверяет single-writer через граф
- **frontend-review-agent** — анализирует зависимости компонентов

---

## Структура файлов

```
graphify-out/           # .gitignore'd, генерируется локально
├── graph.json          # Полный граф в JSON
├── GRAPH_REPORT.md     # Human-readable отчёт
└── cache/              # Внутренний кэш graphify

.cursor/rules/
└── graphify.mdc        # Cursor-правило для graphify
```

---

## Решение проблем

### `py -3` не найден

```bash
# Windows: использовать py -3
py -3 --version

# Если не установлен: https://www.python.org/downloads/
# Или: python вместо py -3
```

### Graph build слишком долгий

```bash
# Проверить .graphifyignore — исключить node_modules, dist, .next
cat .graphifyignore

# AST-only rebuild быстрее полного:
npm run graphify:rebuild
```

### Пустой GRAPH_REPORT.md

```bash
# Убедиться, что graphify установлен:
pip show graphifyy

# Переустановить:
pip install --force-reinstall graphifyy