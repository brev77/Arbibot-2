# DEX-1.4 — Base и BNB (расширение сети после Arbitrum)

> Текущий прогресс: 1/2 → `done`. Следующий шаг: `DEX-1-4-BNB`.

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
- **status:** `planned`
- **depends_on:** [`DEX-1-4-BASE`]
- **risk_level:** `medium`
- **estimated_hours:** `10`
- **acceptance_criteria:** E2E testnet; runbook
- **outputs:**
  - BNB chainId and addresses in `contracts-eth`
  - Pancake/Biswap adapters
  - Smoke test on BNB testnet (`tools/e2e-dex1-bnb-testnet.mjs`)
  - Runbook for BNB deployment (`docs/dex-bnb-runbook.md`)
- **edge_cases:** Different router ABI (Pancake vs Uniswap), higher gas costs on BNB
- **rollback_procedure:** Удалить BNB из supported chains