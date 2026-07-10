# Paper→Live Boundary Contract

Полный контракт изоляции между paper trading и live execution в Arbibot 2.
Загружается при аудите paper→live promotion, режима execution, или подозрении на contamination.

## Принцип

**Paper path и live path — два изолированных bounded context.** Paper validation — это пререквизит go-live,
но paper код никогда не должен касаться live капитала, live wallet, live execution path. Обратно — live path
не должен зависеть от paper-only артефактов.

Это не «best practice» — это инвариант, нарушение которого = прямой риск капиталу.

## Что живёт в paper context

| Артефакт | Расположение | Single-writer |
| --- | --- | --- |
| `PaperTrade` entity | `@arbibot/persistence`, migration `016` | `paper-trading-service` |
| `PaperPromotionCandidate` | migration `017` | `paper-trading-service` |
| `PaperCapitalReservation` | migration `021` | `paper-trading-service` |
| `PaperDiscoveryCandidate` | migration `022/023` | `paper-trading-service` |
| `PaperDriftSample` | migration `016` + `028` (`route_key`) | `paper-trading-service` |
| Paper config key `paper.discovery` | config-service | config-service (single-writer) |
| Virtual capital logic | `PaperCapitalService` | `paper-trading-service` |

**Принадлежность paper:** `apps/paper-trading-service` — единственный writer paper-сущностей. Все остальные сервисы
читают через HTTP read-only BFF, либо получают события через outbox/inbox.

## Что живёт в live context

| Артефакт | Расположение | Single-writer |
| --- | --- | --- |
| `ExecutionPlan` / `ExecutionLeg` | `execution-orchestrator` | execution-orchestrator |
| `CapitalReservation` (live) | capital-service | capital-service |
| `OnChainTransaction`, `WalletState`, `Approval`, `DexPool` | migration `033` | execution-orchestrator + wallet mgmt |
| `BridgeTransfer` | migration `036` | execution-orchestrator + bridge worker |
| Live wallet sign | `WalletManagerService` + `KeyVaultService` | execution path only |
| `dex.live`, `dex.limits` config | config-service | config-service |
| Live on-chain broadcast | execution-orchestrator | execution-orchestrator |

**Принадлежность live:** `execution-orchestrator` + `capital-service` + `WalletManagerService` — единственные
writers live-сущностей. Live wallet key расшифровывается только в этом path.

## Запрещённые импорты (import-graph контракт)

### `apps/paper-trading-service/` НЕ должен импортировать

- `@arbibot/capital-service` (live capital)
- `execution-orchestrator` wallet/signer modules
- `WalletManagerService`, `KeyVaultService`, `getEncryptedKey`
- Live `ExecutionPlan` / `ExecutionLeg` write path
- `OnChainTransaction` write path
- Live on-chain broadcast utilities

**Verification:**
```bash
grep -rn "from '@arbibot/capital-service'\|from '@arbibot/execution-orchestrator'\|WalletManager\|KeyVault\|getEncryptedKey" \
  apps/paper-trading-service/src/ --include="*.ts" \
  | grep -v "test\|spec\|mock\|__mocks__"
```
Ожидаемый результат: пустота. Любой match = contamination (C3).

### Live services НЕ должны зависеть от paper-only артефактов в runtime

- `capital-service` не импортирует `PaperCapitalReservation`
- `execution-orchestrator` live path не вызывает `paper-enqueue`, `PaperCapitalService`
- Live wallet sign path не пересекается с paper trade approval

**Допустимое направление:** paper → live через **promotion gate** (явный, operator-approved), не через runtime import.

## Promotion gate (paper → live)

Единственный легитимный путь перехода paper → live:

1. **Discovery:** paper-trading-service накапливает `PaperTrade`, `PaperDriftSample`, `PaperDiscoveryCandidate`.
2. **Quality scoring:** `qualityTier` / `qualityScore` (migration `030`) вычисляется на основе drift, success rate, profit consistency.
3. **Promotion candidate:** `PaperPromotionCandidate` создается, operator видит в `/paper` UI.
4. **Operator approval:** через `DestructiveOperatorAction` pattern (impact preview + approval) в `/paper/promotion-candidates/[id]?action=approve`.
5. **Activation:** route/token переходит из paper-config в `dex.live` config (отдельный ключ, не общий mutable state).
6. **Capital:** live ExecutionPlan начинает использовать route/token, резервируя реальный капитал через capital-service.

**Запрещённые обходы:**
- Автоматическое продвижение без operator approval.
- Promotion без `qualityTier` / `qualityScore` check.
- Общий config-ключ для paper и live (`dex.live` ≠ paper config, всегда отдельные).
- Shared wallet entity / wallet service между paper и live.

## Verification-чеклисты boundary

### PL.1 — Import-graph проверка

```bash
# Paper → live contamination
grep -rn "capital-service\|execution-orchestrator\|WalletManager\|KeyVault\|getEncryptedKey" \
  apps/paper-trading-service/src/ --include="*.ts" | grep -v "test\|spec\|mock"

# Live → paper contamination (runtime)
grep -rn "PaperCapitalReservation\|paper-enqueue\|PaperCapitalService\|PaperTrade" \
  apps/capital-service/src/ apps/execution-orchestrator/src/ --include="*.ts" | grep -v "test\|spec\|mock"
```

Оба должны вернуть пустоту.

### PL.2 — Config separation

- `dex.live` config-key существует отдельно от paper-config.
- Paper promotion не мутирует `dex.live` напрямую — только через config-service с operator approval.
- Проверить: `grep -rn "dex.live" apps/ packages/ --include="*.ts"` показывает чтение только в live context.

### PL.3 — Entity separation

- `PaperCapitalReservation` (migration `021`) ≠ live `CapitalReservation` — разные таблицы.
- `PaperTrade` ≠ live `ExecutionPlan` — разные агрегаты.
- Wallet entity: paper (если есть) ≠ live `WalletState` (migration `033`).

### PL.4 — Operator action marking

- HERMES UI / operator dashboard чётко маркирует каждый action как paper или live.
- Нет ambigous «execute» без указания режима.
- `DestructiveOperatorAction` integration для всех paper→live promotion flows.

### PL.5 — Capital ceiling respect

- Paper virtual capital не учитывается в live capital ceiling (`dex.limits` max-exposure).
- Live capital-service не знает о paper reservations.
- Сумма live reservations + live позиций ≤ `dex.limits` ceiling (paper excluded).

## Известные boundary-риски в текущей реализации

- **Opportunity → paper promotion:** `opportunity-service` пишет `PaperPromotionCandidateRequested` в outbox → relay в paper-trading. Это **read-only direction** (opportunity не пишет в paper-сущности напрямую). Валидно, если relay идёт через HTTP inbox, не через прямой import.
- **Config-service:** общий для paper и live config. Валидно (config-service — single-writer для всех config-key), но `paper.discovery` ≠ `dex.live` должны оставаться отдельными ключами.
- **HERMES gateway:** читает и paper, и live summaries для dashboard. Это **read-only** через BFF, валидно. Но mutations через HERMES (`/api/operator/HERMES/v1/*` POST/PATCH) должны чётко различать paper/live target.

## Что делать при обнаружении contamination

1. **REQUEST_CHANGES** — merge блокируется.
2. Описать конкретный импорт / shared state / cross-call.
3. Требовать разделение: вынести общую логику в `@arbibot/contracts` (типы, не runtime) или через событийный contract.
4. Перепроверить после исправления через PL.1 grep.
