# DEX-2 — Multi-Chain (DEX A на chain X → bridge → DEX B на chain Y)

> Все шаги в состоянии `planned`. DEX-1 должен быть полностью `done` до начала DEX-2.
> Гейт: все `DEX-1-*` с критериями «done» для single-chain e2e.

---

## `DEX-2-0-ADR` — ADR: cross-chain план, single-writer, idempotency bridge tx

- **step_id:** `DEX-2-0-ADR`
- **status:** `planned`
- **depends_on:** [`DEX-1-3-LIVE-MAINNET`]
- **risk_level:** `critical`
- **estimated_hours:** `6`
- **outputs:** ADR cross-chain execution, single-writer boundaries для bridge legs, idempotency patterns

---

## `DEX-2-1-BRIDGE-ACROSS` — Адаптер Across

- **step_id:** `DEX-2-1-BRIDGE-ACROSS`
- **status:** `planned`
- **depends_on:** [`DEX-2-0-ADR`]
- **risk_level:** `high`
- **estimated_hours:** `16`
- **outputs:** `AcrossBridgeAdapter`, bridge tracking service, testnet e2e script

---

## `DEX-2-1-BRIDGE-STG` — Адаптер Stargate

- **step_id:** `DEX-2-1-BRIDGE-STG`
- **status:** `planned`
- **depends_on:** [`DEX-2-1-BRIDGE-ACROSS`]
- **risk_level:** `high`
- **estimated_hours:** `16`
- **outputs:** `StargateBridgeAdapter`, bridge limits documentation

---

## `DEX-2-1-BRIDGE-NATIVE` — Официальные мосты L2

- **step_id:** `DEX-2-1-BRIDGE-NATIVE`
- **status:** `planned`
- **depends_on:** [`DEX-2-1-BRIDGE-STG`]
- **risk_level:** `high`
- **estimated_hours:** `16`
- **outputs:** `NativeBridgeAdapter`, long finality runbook

---

## `DEX-2-2-PLAN` — Multi-leg план: DEX leg → bridge leg → DEX leg

- **step_id:** `DEX-2-2-PLAN`
- **status:** `planned`
- **depends_on:** [`DEX-2-1-BRIDGE-ACROSS`, `DEX-2-1-BRIDGE-STG`]
- **risk_level:** `critical`
- **estimated_hours:** `16`
- **outputs:** Multi-leg plan builder, `chainId` на `ExecutionLeg`, cross-chain state machine

---

## `DEX-2-3-RECON-XCHAIN` — Сверка кросс-чейн

- **step_id:** `DEX-2-3-RECON-XCHAIN`
- **status:** `planned`
- **depends_on:** [`DEX-2-2-PLAN`]
- **risk_level:** `high`
- **estimated_hours:** `12`
- **outputs:** Bridge reconciliation detectors, bridge timeout incidents, force unwind runbook

---

## `DEX-2-4-E2E` — E2E multi-chain: testnet → mainnet

- **step_id:** `DEX-2-4-E2E`
- **status:** `planned`
- **depends_on:** [`DEX-2-3-RECON-XCHAIN`]
- **risk_level:** `critical`
- **estimated_hours:** `20`
- **outputs:** `npm run e2e:dex2-multichain`, env documentation, success metrics