# D4-B-3-CEILING — Aggregate capital ceiling (угроза C1)

| Поле | Значение |
|------|----------|
| **depends_on** | `D4-B-0-LIVE-ADR` |
| **risk_level** | `high` |
| **estimated_hours** | 6 |
| **status** | `planned` |

## Контекст (из ревью)
`apps/capital-service/src/capital/capital.service.ts:36` `reserve()` делает `FOR UPDATE` на **отдельную** reservation, но **не проверяет `SUM(active reservations + open positions) ≤ ceiling`** — нет защиты от C1-race. Трекер дневного оборота in-memory (см. D4-B-2). Угроза **C1 (🔴)** в threat-model требует «atomic check сумма активных reservations vs ceiling» (L3).

## Outputs
- В `capital.service.reserve()` — перед insert reservation:
  ```sql
  BEGIN;
  SELECT SUM(amount) AS active_total
    FROM capital_reservations
    WHERE status = 'active'
    FOR UPDATE;   -- блокирует конкурентные reserve()
  -- если active_total + dto.amount > ceiling → throw CapitalCeilingExceeded
  INSERT INTO capital_reservations ...;
  -- + outbox event (существующая логика)
  COMMIT;
  ```
- Источник ceiling: config-service `dex.limits.maxDailyNotionalUsd` (переиспользовать) или новый `capital.limits.aggregateCeilingUsd` — решить в ADR D4-B-0
- Кеш ceiling (TTL ~5s) в capital-service
- Новое исключение `CapitalCeilingExceededError` → HTTP 422 + audit entry
- Метрика `arb_capital_ceiling_active_usd` (gauge) + alert при >80% ceiling

## Acceptance
- [ ] Конкурентные `reserve()` сериализуются (`FOR UPDATE` на aggregate)
- [ ] При превышении ceiling → 422 + audit, reservation не создаётся
- [ ] Ceiling читается из config-service (не хардкод)
- [ ] Юнит-тест: N параллельных reserve на сумму > ceiling → часть отбрасывается корректно
- [ ] Метрика/алёрт при приближении к ceiling

## Edge Cases
- `FOR UPDATE` на `SUM` без строк (пустая таблица) → корректно отрабатывать `active_total = 0`
- Deadlock риск при разных orderings → всегда lock в одном порядке (по status-фильтру)
- Open positions vs reservations → определить в ADR, входят ли open positions в active_total (рекомендация: да)

## Test Commands
```bash
npm run test -w @arbibot/capital-service
npm run build -w @arbibot/capital-service
```

## Rollback
`git checkout -- apps/capital-service/src/capital/capital.service.ts`
