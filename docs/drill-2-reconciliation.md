# Drill #2 — Reconciliation P0 (mismatch detection + operator procedure)

> **Step:** `P7-4-DRILL-RECON` ([`.cursor/plans/DEVELOPMENT_PLAN7.md`](../.cursor/plans/DEVELOPMENT_PLAN7.md))
> **Procedure:** [`docs/reconciliation-p0-procedures.md`](reconciliation-p0-procedures.md)
> **Simulator:** `tools/drill-2-reconciliation.mjs` (`npm run drill:2`)

Симулирует reconciliation mismatch (`kind = completed_plan_missing_portfolio`),
проверяет цепочку inject → reconciliation-service `/mismatches` → operator UI, и
репетирует operator procedure (investigating → resolved).

## Когда запускать

- **Перед live с реальным капиталом** (триггер в [`docs/TODO.md`](TODO.md) Drills).
- После изменений в `reconciliation-service` (детекторы, `/mismatches` API).
- Регулярно (раз в месяц) — чтобы оператор не забыл процедуру.

## Критерии успеха (DoD)

- **Auto:** drill инъецирует строку → `GET /mismatches` видит её → `POST /mismatches/run-detectors` идемпотентен (не дублирует) → cleanup удаляет строку.
- **Manual (operator):** открыть `/incidents` → отфильтровать `open` → найти drill-mismatch → перевести `investigating` → `resolved` через UI.
- **MTTA/MTTR:** цель — operator замечает новый mismatch и начинает investigate **< 15m** (SLA v0 из `reconciliation-p0-procedures.md`: acknowledge < 4 business hours, но drill репетирует быструю реакцию).

## Prerequisites

```bash
# 1. Запустить dev-стек (Postgres 15432 + Redis)
docker compose -f infra/docker-compose.dev.yml up -d postgres redis

# 2. Применить миграции (011 — reconciliation_mismatches + остальные)
npm run db:migrate

# 3. Поднять reconciliation-service
npm run dev:reconciliation   # порт 3017
```

## Запуск drill'а

### Автоматическая часть (симулятор)

```bash
# Полный прогон: preflight → inject → verify detection → cleanup
npm run drill:2

# Сухой прогон (только preflight + baseline, без инъекции)
DRILL_DRY_RUN=true npm run drill:2

# Оставить drill-строку для ручной отладки UI (cleanup пропускается)
DRILL_KEEP_INJECTED=true npm run drill:2
# Manual cleanup после:
#   psql "$DATABASE_URL" -c "DELETE FROM reconciliation_mismatches WHERE details->>'drill' = 'true';"
```

**Env:**

| Переменная | Default | Назначение |
|------------|---------|-----------|
| `DATABASE_URL` | `postgres://arbibot:arbibot@127.0.0.1:15432/arbibot` | Postgres OLTP |
| `RECONCILIATION_URL` | `http://127.0.0.1:3017` | reconciliation-service |
| `DRILL_DRY_RUN` | `false` | только preflight, без inject |
| `DRILL_KEEP_INJECTED` | `false` | не удалять drill-строку после |

### Ручная часть (оператор)

После `DRILL_KEEP_INJECTED=true npm run drill:2` (строка оставлена):

1. Открыть `/incidents` в Operator Web.
2. Отфильтровать `status = open`.
3. Найти drill-mismatch (`details.planId` начинается с `DRILL-`).
4. Нажать **Investigate** → статус `investigating` (зафиксировать время — начало MTTA).
5. Нажать **Mark resolved** → статус `resolved` (зафиксировать время — конец MTTR).

### Cleanup

Drill автоматически удаляет свою строку (если не `DRILL_KEEP_INJECTED=true`).
Safety net: любой прогон также удаляет leftover drill-строки с `details->>'drill' = 'true'`
от прошлых прерванных запусков.

```bash
# Полный ручной cleanup (если что-то осталось):
psql "$DATABASE_URL" -c "DELETE FROM reconciliation_mismatches WHERE details->>'drill' = 'true';"
```

## Лог drill'а

Записать в [`docs/TODO.md`](TODO.md) Drills-таблицу (строка «Reconciliation P0»):

- Дата прогона.
- Auto verdict (PASS/FAIL).
- MTTA / MTTR (manual operator part).
- Заметки (были ли проблемы с UI/detection).

## Troubleshooting

- **`postgres DOWN`** — проверь `DATABASE_URL`, что dev-stack подняти (`docker compose ps`).
- **`reconciliation-service DOWN`** — `npm run dev:reconciliation`, проверь порт 3017.
- **`drill row NOT FOUND` после inject** — `/mismatches` мог вернуть объект с другим полем (`items` vs массив). Drill проверяет оба; если API изменился, обнови step4.
- **`detector DUPLICATED` (WARN)** — `run-detectors` нашёл реальный `completed_plan_missing_portfolio` с тем же planId (маловероятно для `DRILL-` префикса, но возможно если detector не фильтрует drill-маркер). Проверь, что detector SQL не матчит `details->>'drill'`.
- **Drill-строка осталась после fatal** — drill best-effort удаляет её, но при crash сети может остаться. Safety net в начале следующего прогона + ручная команда выше.

## Что drill НЕ покрывает

- Реальный mismatch из production-данных (drill использует синтетическую строку с маркером).
- DEX-specific детекторы (`dex_receipt_leg_mismatch` и др.) — отдельный drill при необходимости.
- Alert `ReconciliationOpenMismatches` — это отдельная цепочка (Prometheus), здесь тестируется только reconciliation API + operator procedure.
