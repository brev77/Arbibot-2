# DEX-1.1 — Подготовка к DEX: approve pattern, адаптеры

> Все шаги в этом разделе → **`done`** ✅

---

## `DEX-1-1-APPROVE-PATTERN` — Approve/unapprove утилита

- **step_id:** `DEX-1-1-APPROVE-PATTERN`
- **status:** `done` ✅
- **review_passed_date:** 2026-04-30
- **depends_on:** [`DEX-1-0-MIGRATIONS`, `DEX-1-0-VAULT`, `DEX-1-0-WALLET-MGT`]
- **outputs:** `TokenApproveService` (checkAllowance, approveToken, revokeApproval), in-memory cache, metrics `arb_dex_approve_total`
- **env vars:** `DEX_APPROVE_GAS_LIMIT`, `DEX_ALLOWANCE_CACHE_TTL_MS`

---

## `DEX-1-1-SLIPPAGE` — Slippage protection

- **step_id:** `DEX-1-1-SLIPPAGE`
- **status:** `done` ✅
- **review_passed_date:** 2026-04-30
- **depends_on:** [`DEX-1-0-POOL-DISCOVERY`, `DEX-1-0-GAS`]
- **outputs:** `SlippageProtectionService` (calculateMinimumAmountOut, validateSlippage), tolerance levels (high-liq 0.5%, mid-liq 1%, low-liq 5%), metrics
- **env vars:** `DEX_SLIPPAGE_HIGH_LIQ_BPS`, `DEX_SLIPPAGE_MID_LIQ_BPS`, `DEX_SLIPPAGE_LOW_LIQ_BPS`, `DEX_SLIPPAGE_MAX_BPS`

---

## `DEX-1-1-ADAPTER-UNI2` — Uniswap V2 адаптер

- **step_id:** `DEX-1-1-ADAPTER-UNI2`
- **status:** `done` ✅
- **depends_on:** [`DEX-1-0-ABIS`, `DEX-1-0-RPC`, `DEX-1-0-VAULT`, `DEX-1-0-WALLET-MGT`, `DEX-1-1-APPROVE-PATTERN`]
- **risk_level:** `critical`
- **outputs:** `UniswapV2Adapter` (submitLeg → { externalOrderId: txHash }), swapExactTokensForTokens calldata, ERC20 approve, on-chain quote + slippage, gas policy, Prometheus metrics; 21/21 unit tests
- **supported chains:** Arbitrum (42161), Base (8453), BNB (56)

---

## `DEX-1-1-ADAPTER-UNI3` — Uniswap V3 адаптер

- **step_id:** `DEX-1-1-ADAPTER-UNI3`
- **status:** `done` ✅
- **review_passed_date:** 2026-05-05
- **depends_on:** [`DEX-1-1-ADAPTER-UNI2`]
- **risk_level:** `high`
- **outputs:** `UniswapV3Adapter` (exactInputSingle), DexSwapParamsV3 (fee, sqrtPriceLimitX96), shared slippage utils; 21/21 unit tests
- **commit:** `a48c644`

---

## `DEX-1-1-ADAPTER-SUSHI` — SushiSwap адаптер

- **step_id:** `DEX-1-1-ADAPTER-SUSHI`
- **status:** `done` ✅
- **review_passed_date:** 2026-05-05
- **depends_on:** [`DEX-1-1-ADAPTER-UNI2`]
- **outputs:** `SushiSwapV2Adapter`, shared utils с UniV2 (`extractSwapParams`), router addresses (Arbitrum SushiSwap, BNB PancakeSwap), Base → VenueSubmitClientError; 19/19 tests

---

## `DEX-1-1-VENUE-BIND` — Связка с VenueAdapter / DI

- **step_id:** `DEX-1-1-VENUE-BIND`
- **status:** `done` ✅
- **review_passed_date:** 2026-05-05
- **depends_on:** [`DEX-1-1-ADAPTER-UNI2`]
- **outputs:** `VenueFactoryService` (extractVenueKey, resolveAdapter, submitLeg), feature flag `DEX_VENUE_ENABLED`, LegsModule DI; 21/21 tests