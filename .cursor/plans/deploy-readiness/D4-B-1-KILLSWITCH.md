# D4-B-1-KILLSWITCH — Реальный kill-switch в execution-orchestrator

| Поле | Значение |
|------|----------|
| **depends_on** | `D4-B-0-LIVE-ADR` |
| **risk_level** | `high` |
| **estimated_hours** | 6 |
| **status** | `done` |

## Контекст (из ревью)
`grep -rn "killSwitch\|DEX_LIVE_KILL_SWITCH" apps/ packages/ --include="*.ts"` → совпадения **только** в `apps/web` (`dex-config-types.ts`, `use-dex-config.ts`). В бэкенде kill-switch **не существует**. Доки (`docs/dex-rollback-strategy.md:189-200`, `deployment-readiness-assessment.md:103`) описывают его как существующий — это фикция. Угроза **C2 (🔴)** (L1).

## Outputs
- `apps/execution-orchestrator/src/execution/risk/dex-kill-switch.service.ts` — сервис:
  - Читает `dex.limits.killSwitch` из config-service (кешированный `PolicyCacheService`-аналог или новый `DexConfigCache`)
  - Override env `DEX_LIVE_KILL_SWITCH=true` (operator emergency)
  - Метод `isLiveHalted(): boolean` / `assertLiveNotHalted(): void` (throws)
- Инжектировать в место broadcast'а live-leg (execution flow), вызывать `assertLiveNotHalted()` **перед** каждым live-leg
- Метрика `arb_dex_live_halt_active` (gauge 0/1) + alert в `infra/prometheus/alerts.yml`
- Обновить `docs/dex-rollback-strategy.md` — привести код-пример в соответствие с реализацией

## Acceptance
- [x] При `dex.limits.killSwitch=true` (config-service) новые live-leg блокируются — `dex-kill-switch.service.ts:216-223,253-256`, `legs.service.ts:290-291`
- [x] При `DEX_LIVE_KILL_SWITCH=true` (env) блокируются даже без config-service — `dex-kill-switch.service.ts:90-102,238-243` (env override)
- [x] Paper-path **не** затронут (kill-switch только для live) — `legs.service.ts:280-292` (gate только для `isBridgeLeg || isLiveVenueKey`)
- [x] Метрика `arb_dex_live_halt_active` отражает состояние — `dex-kill-switch.service.ts:33,166-179,287-289`, alert `infra/prometheus/alerts.yml:90`
- [x] Юнит-тесты: kill on → throws; kill off → pass; config-service down → fail-closed — `dex-kill-switch.service.spec.ts` (18 `it()`, fail-closed `:153-162`)
- [x] Латентность проверки < 5ms (кешированный) — background-refresh `dex-kill-switch.service.ts:147-156` (in-memory read)

## Edge Cases
- In-flight leg в момент включения → ADR-решение (D4-B-0): рекомендация — довыполнить начатый, блокировать новые
- Cache TTL vs срочность operator override → env-override имеет приоритет над кеши
- Concurrent toggle → атомарный boolean read достаточно

## Test Commands
```bash
npm run test -w @arbibot/execution-orchestrator
npm run build -w @arbibot/execution-orchestrator
```

## Rollback
`git checkout -- apps/execution-orchestrator/src/execution/risk/ apps/execution-orchestrator/src/execution/execution.module.ts docs/dex-rollback-strategy.md` + удалить `dex-kill-switch.service.ts`
