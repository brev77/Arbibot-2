# D4-B-0-LIVE-ADR — ADR: live-gate архитектура (kill-switch + limits + capital ceiling)

| Поле | Значение |
|------|----------|
| **depends_on** | `D4-A-7-PAPER-SMOKE` |
| **risk_level** | `high` |
| **estimated_hours** | 3 |
| **status** | `done` |

## Контекст (из ревью)
Несколько капитально-критичных контролей существуют только в документации. ADR объединяет решения по архитектуре live-gate перед реализацией L1–L8.

## Outputs
- `docs/adr-live-gate.md` — архитектурный документ:

### 1. Kill-switch (L1)
- Механизм: in-process проверка `dex.limits.killSwitch` (из config-service `effective`) **перед** каждым live-leg broadcast в execution-orchestrator
- Источник правды: config-service `GET /policy/configurations/dex.limits/effective` (уже сеется миграцией 035)
- Доп. env `DEX_LIVE_KILL_SWITCH` как override (operator emergency, без правки config-service)
- Fail-state: при невозможности прочитать config → fail-closed (блокировка live, paper продолжает)

### 2. dex.limits / dex.live потребление (L2)
- `DexRiskPolicyService.getEffectiveConfig()` → читает config-service вместо хардкода
- `evaluateTrade()` вызывается из всех DEX-адаптеров (`biswap-v2`, `pancakeswap-v2`, `sushiswap-v2`, `uniswap-v2`, `uniswap-v3`) перед `selectWallet`
- Дневной объём — персист в БД, не in-memory (переживает рестарт)

### 3. Capital aggregate ceiling (L3)
- В `capital.service.reserve()`: `SELECT SUM(amount) FROM capital_reservations WHERE status='active' FOR UPDATE` + сравнение с ceiling из config
- Ceiling ключ: `capital.limits` (новый config-ключ) или переиспользовать `dex.limits.maxDailyNotionalUsd`

### 4. Ключи (L4), mTLS (L6), two-person (L8), bridge finality (L5)
- Ссылки на подшаги D4-B-3/4/5/6/7

## Decision criteria
- Paper/live изоляция: kill-switch и limits **не должны** влиять на paper-path
- Latency: проверка kill-switch < 5ms (кешированный config)
- Backward-compat: новые config-ключи имеют safe-defaults (`enabled:false`)

## Edge Cases
- Race между operator-включением kill-switch и in-flight leg → задокументировать (fail-closed для новых, in-flight довыполнить или отменить?)
- Config-service недоступен → fail-closed + alert

## Test Commands
```bash
test -f docs/adr-live-gate.md
```

## Rollback
`rm docs/adr-live-gate.md` (ADR-only)
