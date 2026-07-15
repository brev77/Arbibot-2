# D4-B-3-CEILING — Aggregate capital ceiling (угроза C1)

| Поле | Значение |
|------|----------|
| **depends_on** | `D4-B-0-LIVE-ADR` |
| **risk_level** | `high` |
| **estimated_hours** | 6 |
| **status** | `done` |

## Реализация (2026-07-15)

| Под-шаг | Суть |
|---------|------|
| Схема | Миграции `040_portfolio_positions_notional_usd.sql` (колонка) + `041_capital_limits_seed.sql` (сид `capital.limits`) |
| persistence | `PortfolioPositionEntity.notionalUsd` (numeric 24,8, default '0') |
| portfolio-service (single-writer notional) | `ConfirmFillDto.notionalUsd` (optional decimal string) + `PositionsService.confirmFill` накапливает notional параллельно quantity |
| execution-orchestrator (источник notional) | `FillOutboundService` переоценивает `tokenIn` через `PriceOracleService` в момент fill; `legs.service.ts` резолвит chainId (on-chain tx) + tokenIn (playbook leg) |
| capital-service (гейт) | `CapitalLimitsService` (config-service `capital.limits` + fail-closed env `CAPITAL_MAX_ACTIVE_USD`); `CapitalService.reserve()` — `FOR UPDATE` SUM активных резервирований + SUM открытых позиций, `CapitalCeilingExceededError` → 422; метрика `arb_capital_ceiling_active_usd` |

**Объём (решение product-owner):** reservations + открытые позиции (полный C1.3). Расхождение ADR §3 (reservations-only) vs C1.3 чеклиста (reservations + open positions) разрешено в сторону C1.3: открытые позиции включены через `portfolio_positions.notional_usd`.

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
- [x] Конкурентные `reserve()` сериализуются (`FOR UPDATE` на aggregate)
- [x] При превышении ceiling → 422 + audit, reservation не создаётся
- [x] Ceiling читается из config-service (не хардкод)
- [x] Юнит-тест: превышение ceiling → блок (6 кейсов в capital.service.spec)
- [x] Метрика/алёрт при приближении к ceiling (`arb_capital_ceiling_active_usd`)
- [x] Открытые позиции включены в active_total (полный C1.3)

## Edge Cases
- `FOR UPDATE` на `SUM` без строк (пустая таблица) → корректно отрабатывать `active_total = 0`
- Deadlock риск при разных orderings → всегда lock в одном порядке (по status-фильтру)
- Open positions vs reservations → определить в ADR, входят ли open positions в active_total (рекомендация: да)

## Test Commands
```bash
npm run lint -w @arbibot/persistence && npm run build -w @arbibot/persistence && npm test -w @arbibot/persistence      # 5/5
npm run lint -w @arbibot/portfolio-service && npm run build -w @arbibot/portfolio-service && npm test -w @arbibot/portfolio-service   # 13/13
npm run lint -w @arbibot/execution-orchestrator && npm run build -w @arbibot/execution-orchestrator && npm test -w @arbibot/execution-orchestrator   # 494/494
npm run lint -w @arbibot/capital-service && npm run build -w @arbibot/capital-service && npm test -w @arbibot/capital-service   # 18/18
npm run db:migrate   # применит 040 + 041
```

## Rollback
`git checkout -- apps/capital-service/ apps/portfolio-service/src/positions/ apps/execution-orchestrator/src/legs/ packages/persistence/src/portfolio-position.entity.ts` — миграции 040/041 forward-only (колонка DEFAULT 0, сид конфига идемпотентный).
