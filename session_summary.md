# Session summary — 2026-04-12

Краткий handoff по решениям и контексту сессии (архитектура, план, документация).

## Принятые решения

1. **Phase 1 в `DEVELOPMENT_PLAN.md`**
   - **Foundation (§1.1 + §1.2):** все шаги `P1-1.1-*` и `P1-1.2-*` переведены в **`done`** после зафиксированного **`review_passed`** (в т.ч. `P1-1.1-PG` / `REDIS`: в тексте ревью явная цепочка `implemented` → `review_passed` → `done`).
   - **Frontend baseline (§1.3):** `P1-1.3-NEXT`, `LAYOUT`, `M1`, `STUBS` оставлены в **`review_passed`**; формальный **`done`** слоя 1.3 — отдельно, при выполнении DoD §50.3 по operator UI.
   - **Матрица P0:** `PRIO-P0-CANON`, `INTAKE`, `OPP`, `RISK`, `CAP`, `OIB`, `AUD` синхронизированы с канонами → **`done`**. **`PRIO-P0-EPL`** остаётся **`in_progress`** (полный leg / §19 — в `P2-2.1-EPL`).

2. **RBAC и опасные действия (ранее в сессии / репо)**
   - Минимальная роль для **`/portfolio`** (и ряда маршрутов) — **`operator`**, согласовано с демо destructive actions и навигацией.

3. **Инварианты (зафиксировано в коде до/в рамках сессии)**
   - **Single-writer капитала:** оркестратор не пишет в `capital_reservations` как SoT; проверки approved risk + pre-linked reservation перед `link` / `arm`.
   - **Outbox relay (opportunity):** `processed_at` только при успешном доменном исходе; retry / dead-letter для прочих случаев; relay фильтрует типы событий (не забирает `SnapshotUpdated` с общей outbox).

## Ключевые изменённые файлы (эта сессия / непосредственно связанный контекст)

- **`.cursor/plans/DEVELOPMENT_PLAN.md`** — массовое обновление статусов Phase 1 + PRIO + «Последнее обновление».
- **`docs/progress.md`**, **`session_summary.md`** (этот файл) — журнал и handoff.

## Открытые вопросы / след. шаги

- Подтвердить **полный** прогон **`npm run lint` / `build` / `test`** после последних правок (в сессии был прерванный/фоновый lint).
- **§50.3:** явное закрытие Phase 1 целиком, если требуется перевести `P1-1.3-*` в `done`.
- **`PRIO-P0-EPL` / `P2-2.1-EPL`:** оставшийся scope (partial fill, матрица ошибок venue, E2E).
- По правилам репо: при крупных правках кода — **graphify** code refresh (`python -c "from graphify.watch import _rebuild_code; ..."`), если `graphify-out/` используется локально.
