# DEX-1.4 — Network Expansion (Base, BNB, Arbitrum)

> Текущий прогресс: 3/3 → `done`.

---

## `DEX-1-4-BASE` — Base: те же DEX

- **step_id:** `DEX-1-4-BASE`
- **status:** `done` ✅
- **review_passed_date:** 2026-05-11
- **depends_on:** [`DEX-1-3-LIVE-MAINNET`]
- **outputs:** Base Sepolia chainId fix (84531→84532), `tools/e2e-dex1-base-testnet.mjs`, `docs/dex-base-runbook.md`, primary venue: Uniswap V3 (Base); Build 21/21 ✅, Lint 28/28 ✅

---

## `DEX-1-4-BNB` — BNB Chain: Pancake / Biswap

- **step_id:** `DEX-1-4-BNB`
- **status:** `done` ✅
- **review_passed_date:** 2026-05-14
- **depends_on:** [`DEX-1-4-BASE`]
- **risk_level:** `medium`
- **estimated_hours:** `10`
- **acceptance_criteria:** E2E testnet; runbook ✅
- **outputs:**
  - BNB chainId and addresses in `contracts-eth`
  - PancakeSwap V2 adapter (`pancakeswap-v2.adapter.ts`) — testnet (97) + mainnet (56)
  - Biswap V2 adapter (`biswap-v2.adapter.ts`) — mainnet only (56)
  - Unit tests: PancakeSwap 16/16 ✅, Biswap 15/15 ✅
  - Smoke test on BNB testnet (`tools/e2e-dex1-bnb-testnet.mjs`)
  - Runbook for BNB deployment (`docs/dex-bnb-runbook.md`)
  - Build 21/21 ✅, Lint 28/28 ✅
- **edge_cases:** Different router ABI (Pancake vs Uniswap), higher gas costs on BNB, Biswap mainnet-only guard
- **rollback_procedure:** Удалить BNB из supported chains

---

## `DEX-1-4-ARBITRUM` — Arbitrum: Uniswap V2/V3 + SushiSwap

- **step_id:** `DEX-1-4-ARBITRUM`
- **status:** `done` ✅
- **review_passed_date:** 2026-05-14
- **depends_on:** [`DEX-1-4-BNB`]
- **risk_level:** `low`
- **estimated_hours:** `4`
- **acceptance_criteria:** Dedicated E2E smoke; runbook; chainId fix ✅
- **outputs:**
  - Arbitrum Sepolia chainId fix in generic E2E (421613 → 421614)
  - Updated token addresses for Arbitrum Sepolia (WETH, USDC)
  - Dedicated Arbitrum E2E smoke (`tools/e2e-dex1-arbitrum-testnet.mjs`) — paper + testnet modes, adapter selection (UniV2/V3/Sushi)
  - Runbook for Arbitrum deployment (`docs/dex-arbitrum-runbook.md`)
  - Adapters already support Arbitrum (42161, 421614) — UniV2, UniV3, SushiSwap
  - Address verification for Sepolia + Mainnet in E2E
  - Metrics verification for Arbitrum-specific labels
- **edge_cases:** Arbitrum L1 data fee, fast block times (~0.25s), V3 as primary venue
- **rollback_procedure:** Удалить Arbitrum из supported chains, откатить chainId defaults
