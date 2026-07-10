# D4-B-2-LIMITS — dex.limits/dex.live потребление + вызов evaluateTrade

| Поле | Значение |
|------|----------|
| **depends_on** | `D4-B-1-KILLSWITCH` |
| **risk_level** | `high` |
| **estimated_hours** | 8 |
| **status** | `planned` |

## Контекст (из ревью)
- `DexRiskPolicyService.getEffectiveConfig()` (`apps/execution-orchestrator/src/execution/risk/dex-risk-policy.service.ts:44-54`) — хардкод (`maxPositionSizeUsd:10000`, `maxDailyVolumeUsd:100000`) с комментарием `// TODO: integrate with config-service`.
- `DexRiskPolicyService.evaluateTrade()` (строка 70) **не вызывается ни одним сервисом** (L2).
- `dex.limits`/`dex.live` читает только фронтенд.

## Outputs
1. **`DexRiskPolicyService.getEffectiveConfig()`** — читать из config-service:
   - Внедрить HTTP-клиент к `GET /policy/configurations/dex.limits/effective` и `dex.live/effective`
   - Кеш (TTL ~5s, как `PolicyCacheService` в market-intake)
   - Env fallback: `DEX_MAX_SLIPPAGE_BPS`, `DEX_MAX_POSITION_SIZE_USD`, `DEX_MIN_POOL_LIQUIDITY_USD` (сохранить)
   - Убрать хардкод-дефолты
2. **Дневной объём — персист в БД**, не in-memory `Map`:
   - Новая таблица (миграция `039_dex_daily_volume.sql`): `(chain_id, trade_date, notional_usd, updated_at)` с `UPSERT`
   - `getDailyVolume()` → `SELECT notional_usd FROM dex_daily_volume WHERE chain_id=$1 AND trade_date=CURRENT_DATE`
   - `recordTrade()` → `INSERT ... ON CONFLICT DO UPDATE SET notional_usd = dex_daily_volume.notional_usd + $2`
3. **Вызов `evaluateTrade()`** из всех DEX-адаптеров перед `selectWallet`:
   - `biswap-v2.adapter.ts:119`, `pancakeswap-v2.adapter.ts:132`, `sushiswap-v2.adapter.ts:160`, `uniswap-v2.adapter.ts:262`, `uniswap-v3.adapter.ts:261`
   - При `evaluateTrade().allowed === false` → бросить, не broadcast'ить live-leg
4. **Только для live-path**: paper-path не вызывает `evaluateTrade` (изоляция)

## Acceptance
- [ ] `getEffectiveConfig()` возвращает значения из config-service, не хардкод
- [ ] `evaluateTrade()` вызывается во всех 5 DEX-адаптерах перед live-leg
- [ ] При превышении `maxNotionalPerTradeUsd` leg блокируется
- [ ] Дневной объём переживает рестарт процесса (читается из БД)
- [ ] Paper-path не вызывает `evaluateTrade` (юнит-тест)
- [ ] Метрики: `arb_dex_risk_evaluation_total{result=allowed|blocked,reason}`

## Edge Cases
- Config-service недоступен → fail-closed (блок live) или fail-open с cached-last-known-good? → ADR: fail-closed для live
- Часовые пояса `trade_date` → UTC canonical
- Concurrent `recordTrade` → `FOR UPDATE` или atomic `UPSERT` (race на +)

## Test Commands
```bash
npm run test -w @arbibot/execution-orchestrator
npm run build -w @arbibot/execution-orchestrator
npm run db:migrate   # применит 039
```

## Rollback
`git checkout -- apps/execution-orchestrator/src/execution/risk/ apps/execution-orchestrator/src/execution/adapters/` + drop table `dex_daily_volume` (drop миграция не нужна, forward-only)
