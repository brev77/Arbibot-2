# Test Coverage Plan — Arbibot 2 (90% на бизнес-логике backend)

> **Назначение:** план доведения покрытия тестами бизнес-логики backend до 90%.
> Scope: services + controllers + guards в `apps/*` и `packages/*`, исключая boilerplate (DTOs/modules/main.ts/index.ts/interfaces/types/entities). `apps/web` — отдельный трек.
> **Дата создания:** 2026-07-17.
> **Связанные документы:** [`pre-deploy-verification-plan.md`](pre-deploy-verification-plan.md), [`TODO.md`](TODO.md) (risk tracker C3/H3/H4/H5).

---

## Текущее состояние (замер 2026-07-17)

| Пакет | Stmts | Branch | Funcs | Lines | Примечание |
|---|---|---|---|---|---|
| portfolio-service | 94.7 | 81.0 | 90.0 | 94.6 | ✅ OK |
| persistence | 93.8 | 87.5 | 100 | 93.8 | ✅ OK |
| messaging | 100 | 92.9 | 100 | 100 | ✅ OK |
| nest-platform | 88.1 | 72.5 | 84.8 | 88.3 | почти OK |
| canonical-market-service | 78.1 | 80.4 | 81.3 | 77.4 | |
| execution-orchestrator | 77.8 | 65.5 | 79.0 | 77.6 | bridge/ethers непокрыты |
| outbox-kafka-bridge | 70.0 | 50.0 | 42.9 | 70.0 | |
| contracts-eth | 68.3 | 4.3 | 11.1 | 65.3 | branch/funcs критично низко |
| capital-service | 65.4 | 77.4 | 62.1 | 67.4 | controller 0% |
| hermes-mcp-server | 63.1 | 35.7 | 61.3 | 62.7 | |
| opportunity-service | 60.9 | 51.9 | 57.1 | 59.9 | |
| market-intake-service | 55.6 | 40.1 | 52.6 | 54.7 | |
| risk-service | 54.5 | 46.6 | 43.4 | 54.7 | |
| paper-trading-service | 45.7 | 34.8 | 43.5 | 44.6 | ~2200 LOC скрыты от coverage |
| reconciliation-service | 36.2 | 50.5 | 36.1 | 37.3 | |
| hermes-gateway | 24.9 | 18.8 | 26.7 | 24.3 | hermes.controller 0% |
| config-service | **27.52** | 22.67 | 23.25 | 27.32 | был 0% (.js-артефакты в src/, fixed 2026-07-17) |
| audit-service | — | — | — | — | **0 spec** (test script = no-op) |

**Aggregate (взвешенный):** Stmts ~62% измеримых, реальный **~45-50%** с учётом скрытых файлов.

---

## Фаза 0 — Coverage-инфраструктура

**0.1. Унифицировать ts-jest во всех apps/*:**
```json
"transform": { "^.+\\.ts$": ["ts-jest", { "diagnostics": { "ignoreCodes": [151002] } }] }
```
- Фикс config-service coverage bug (убрать `tsconfig.spec.json` с `noEmit:true`).
- Убирает TS151002 warnings везде.

**0.2. `collectCoverageFrom` во всех 18 пакетах** с исключениями boilerplate:
```json
"collectCoverageFrom": [
  "src/**/*.ts",
  "!src/**/*.module.ts", "!src/**/*.dto.ts", "!src/**/*.interface.ts",
  "!src/**/*.type.ts", "!src/**/*.constant.ts", "!src/main.ts", "!src/**/index.ts"
]
```

**0.3. Root `package.json`:** скрипт `test:coverage` + `coverage/` уже в `.gitignore`.

**0.4. CI gating:** добавить `npm run test:coverage` в `build` job, lcov artifact.

---

## Фаза 1 — Quick wins

**1.1. config-service** — фикс `noEmit` (в 0.1), 3 существующих теста дадут ненулевой coverage.

**1.2. `audit.service.spec.ts`** (новый, ~150-220 LOC, паттерн A — fake EntityManager):
- append-only happy path
- idempotent replay (existing key + matching payload)
- idempotency conflict (mismatched payload → ConflictException)
- 23505 race path (unique violation → re-find)
- non-PG error rethrow
- `recent()` clamping
- **Закрывает C3** (audit-service 0 unit-тестов).

**1.3. `paper-trading-service` `collectCoverageFrom`** (в 0.2) — вскроет ~2200 скрытых LOC.

---

## Фаза 2 — ContractFactory (блокер для 90% bridge/DEX)

**2.1. Новые файлы:**
- `execution-orchestrator/src/execution/ethers/contract-factory.interface.ts` — `ContractFactory.create<T>(address, abi, runner): T` + `CONTRACT_FACTORY = Symbol('CONTRACT_FACTORY')`
- `execution-orchestrator/src/execution/ethers/ethers-contract.factory.ts` — `@Injectable()` обёртка

**2.2. Регистрация в `execution.module.ts`:** `{ provide: CONTRACT_FACTORY, useClass: EthersContractFactory }`

**2.3. Миграция 19 сайтов `new Contract` (10 файлов, по риску):**
1. Read-only: `pool-discovery` (2), `price-oracle` (2), `wallet-manager` (1)
2. DEX adapters: `uniswap-v2`, `sushiswap-v2`, `pancakeswap-v2`, `biswap-v2` (4 × getAmountsOut)
3. Bridge: `across` (2), `native` (2), `stargate` (3)
4. `token-approve` (3, signer) — последним

**2.4. Обновить 6 specs** (5 DEX через `new` + price-oracle убрать `jest.mock('ethers')`).

**2.5. Новые specs:** `token-approve.service.spec.ts`, расширить bridge specs, дополнить `pool-discovery.spec.ts`.

**Validation (capital-critical):** build + test + e2e до/после.

---

## Фаза 3 — Critical paths

| Задача | Файл | Закрывает risk |
|---|---|---|
| `panic.service.spec.ts` | config-service | H3 |
| `token-approve.service.spec.ts` | execution-orchestrator | H4 (из Фазы 2) |
| `paper-capital.service.spec.ts` | paper-trading-service | H5 |
| `capital.controller.spec.ts` | capital-service | — |
| HermesAuthGuard `crypto.timingSafeEqual` | hermes-gateway | H2 |

---

## Фаза 4 — Business logic до 90%

По сервисам (дельта coverage):
- hermes-gateway 24.9 → 90 (hermes.controller.spec, hermes-upstream.service.spec, расширить mutation.spec)
- paper-trading-service 45.7 → 90 (paper-drift, paper-trades, paper-promotion)
- risk-service 54.5 → 90 (adaptive-risk, route-scoring-history, profiles, watchlist-tier)
- reconciliation-service 36.2 → 90 (mismatches, alerts.controller, webhook.dto)
- opportunity-service 60.9 → 90 (paper-client, opportunities, outbox-relay)
- market-intake-service 55.6 → 90 (intake-throttle, snapshots)
- capital-service 65.4 → 90 (capital-limits, controller)
- canonical-market-service 78.1 → 90 (redis-connection)
- hermes-mcp-server, outbox-kafka-bridge, contracts-eth — добить

---

## Фаза 5 — Финальный gating

**5.1. `coverageThreshold`** в каждом package.json:
```json
"coverageThreshold": { "global": { "statements": 90, "branches": 85, "functions": 90, "lines": 90 } }
```

**5.2. CI gating** — `npm run test:coverage` FAIL если threshold не достигнут.

**5.3. Документация** — обновить `pre-deploy-verification-plan.md`, `TODO.md` (C3/H3/H4/H5 ✅), `AGENTS.md`.

---

## Паттерны тестирования (референсы в коде)

- **Паттерн A** (fake EntityManager): `apps/execution-orchestrator/src/legs/legs.service.spec.ts`, `apps/risk-service/src/risk/risk.service.spec.ts`
- **Паттерн B** (Nest TestingModule): `packages/nest-platform/src/vault/key-vault.service.spec.ts`, `apps/execution-orchestrator/src/execution/price/price-oracle.service.spec.ts`
- HTTP: `global.fetch = jest.fn()` с save/restore (`dex-kill-switch.service.spec.ts`)
- ethers: после Фазы 2 — `contractFactory.create = jest.fn().mockReturnValue({...})`
- Redis: ручной stub RedisConnection (`market.service.spec.ts`)
- Naming: `it('verb action ...')` present-tense, без `should`

## Журнал выполнения

| Дата | Фаза | Что сделано | Commit | Coverage до → после |
|------|------|-------------|--------|---------------------|
| 2026-07-17 | 0 | Coverage-инфраструктура: ts-jest унифицирован (`diagnostics.ignoreCodes=[151002]` во всех 12 apps), `collectCoverageFrom` с boilerplate-исключениями во всех 12 apps, root `test:coverage` script, audit-service test script `no-op → jest` | (pending) | — |
| 2026-07-17 | 1 | `audit.service.spec.ts` (14 tests, pattern A — fake EntityManager): append-only happy path, idempotent replay, ConflictException (actor/payload mismatch), 23505 race path, non-PG rethrow, `recent()` clamping | `3706411` | audit.service.ts 0% → **100%**; **C3 resolved** |
| 2026-07-17 | 0 | **Spec type-cast fixes:** после Phase 0 unification (ts-jest `ignoreCodes=[151002]`) strict type-check вскрыл TS2345 в 4 specs (partial mocks → full Repository/DataSource, private method spies). Касты нужны для ts-jest, но `@typescript-eslint/no-unnecessary-type-assertion` флагует их как redundant (известный рассинхрон ts-jest ↔ typescript-eslint type-resolution в monorepo). Решения: loose field types (snapshots, reconciliation — `Pick<Repository,'find'>` / `{transaction, getRepository}`) + inline `eslint-disable` casts (canonical-market, paper-discovery — mirrors `legs.service.spec.ts` reference, 14 specs repo-wide). Validation: lint 4/4 exit 0, tests 60/60 (canonical 11 + intake 8 + paper 27 + recon 14). No source changed. | `2def1e9` | unblocks clean `npm run test:coverage` |
| 2026-07-17 | 0 | **market-intake `--runInBand`:** flaky parallel-test failure (snapshots.service.spec мутирует describe-scoped `dataSource` через `Object.assign` → гонка при параллельном запуске spec-файлов в пакете). `jest` → `jest --runInBand` (matches paper-trading-service, hermes-gateway). Сериализует spec-файлы внутри пакета, детерминированный прогон. Validation: market-intake 8/8, full turbo `--force` 29/29 Tasks successful. | `bf5c867` | — |
| 2026-07-17 | — | **RESOLVED — config-service coverage=0%:** корневая причина — **скомпилированные `.js`/`.js.map` артефакты в `src/`** (13 файлов, gitignored — не отслеживаются, локальный мусор от ручного `tsc` без `tsconfig.build.json`). Node резолвил `import './configurations.service'` в `.js` вместо `.ts`, поэтому istanbul не инструментовал source → coverage=0% несмотря на 3 проходящих теста. **Не** `noEmit` (предыдущая гипотеза из Phase 0 была неверной — убирание `noEmit` не помогло). Fix: (1) удалил 26 артефактов из `src/`; (2) удалил лишний `tsconfig.spec.json` (dead config — ts-jest использует `tsconfig.json`, как во всех рабочих пакетах audit/risk). Coverage **0% → 27.52%** (configurations.service.ts → 40.33%). Аналогичных артефактов в других apps/packages нет (сканировано). Build/lint чистые. | `72149ef` | config-service 0% → **27.52%** |
| 2026-07-17 | 3 | **H3 — `panic.service.spec.ts`** (config-service, 14 tests, pattern: direct instantiation с mock `ConfigurationsService` + `IAuditClient`): panicStop happy path (killSwitch false→true, JSON preserve, audit PANIC_STOP_TRIGGERED), already-halted no-op (PANIC_STOP_NOOP), BadRequest при missing dex.limits, default approveReason; panicRecover happy path (true→false), wrong-confirm rejection (never single-click), already-recovered no-op, default approveReason; readKillSwitch resilience (getEffective throws, non-Error throw, non-string configValue, non-boolean killSwitch); setKillSwitch `parsed={}` fallback. **panic.service.ts: 0% → 100% (Stmts/Branch/Funcs/Lines)**; config-service overall 27.52% → **41.78%**. **H3 resolved.** | `121dc2e` | panic.service 0% → **100%** |
| 2026-07-17 | 3 | **H5 — `paper-capital.service.spec.ts`** (paper-trading-service, 10 tests, pattern A — mock Repository `create`/`save`/`findOne`/`createQueryBuilder`): reserveCapital (60-мин TTL assertion, state=active, entityVersion=1, save через create return); getActiveReservation (filter active + DESC order, null когда нет); expireReservation (null если не найден, no-op если уже non-active без save, active→expired с entityVersion bump + save); expireReservations bulk sweep (chained QB update/set/where/andWhere, affected count 7/0/undefined → return 7/0/0). **paper-capital.service.ts: 0% → 96.66% Stmts / 100% Branch / 83.33% Funcs / 96.42% Lines** (uncovered: inline lambda в `.set()` — Istanbul артефакт). **H5 resolved.** | `c33355b` | paper-capital.service 0% → **96.66%** |
| 2026-07-17 | 3 | **H2 — `HermesAuthGuard` timing-safe compare** (hermes-gateway, **source fix + spec**): `Array.includes(provided)` (короткое замыкание `===` → timing side-channel для побайтового восстановления ключа) заменён на `safeKeyEquals()` — `crypto.timingSafeEqual` по каждому allowed key **без early-exit** (running match flag) + length-guarded dummy compare когда длины различаются (чтобы не утекала длина через throw/ранний возврат). Spec расширен 3 → 12 тестов: match first/second key, mismatch, prefix (no partial leak), длина-отличается (dummy branch), empty/unset HERMES_API_KEYS, missing/empty header, array header first-value, trim. **hermes-auth.guard.ts: 0% → 100% (Stmts/Branch/Funcs/Lines)**. **H2 resolved (security fix).** | `c99713b` | hermes-auth.guard.ts 0% → **100%** |
| 2026-07-17 | 3 | **H4 — `token-approve.service.spec.ts`** (execution-orchestrator, 10 tests, pattern B + `jest.mock('ethers')` — **без зависимости от Phase 2 ContractFactory**): approveToken (allowance=0 → single approve confirmed; non-zero non-matching → revoke-first `[0n, 1000n]`; matching allowance → skip revoke `[1000n]`; receipt status=0 → failed; throw → rethrow + error metrics); revokeApproval (approve 0n, chainId из caller, throw → rethrow); getAllowance (bigint из on-chain); getApprovalInfo (full struct); receipt=null → failed + undefined gasUsed. Контрактный safe-approval state machine полностью покрыт (capital-critical). **token-approve.service.ts: 0% → 100% Stmts / 87.5% Branch / 100% Funcs / 100% Lines** (uncovered: gasUsed null-branch в revokeInternal). **H4 resolved. Все Phase 3 risk items (H2/H3/H4/H5) закрыты.** | (pending) | token-approve.service 0% → **100%** |
