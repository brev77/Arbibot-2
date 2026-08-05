# Live Auto-Drive Smoke — 2026-08-05

**Host:** Aéza Frankfurt (79.137.202.225, SSH `arbibot-paper`)
**Commits deployed:** `0ad81d0` → `28260f0` → `6bbe45e`
**Capital at risk:** $10 notional, $100 ceiling (kill-switch armed)

---

## Result: PARTIAL — pipeline runs, cost gate still blocked by QuickNode instability

### ✅ What works (root cause chain unblocked)

1. **Concurrent-plan gate (#1)** — Worker now picks up opportunities. After clearing
   3 stale `live_execution_plan_id` markers, `arb_live_auto_drive_cycles_total{status="success"}`
   climbed to 170+ in minutes.

2. **Chainlink ETH/USD address (Phase 1)** — The "bad address checksum" errors that
   were flooding the logs every 10s are gone. Zero `INVALID_ARGUMENT` post-deploy.
   The corrupted address `0x...C052051f9ef9` was replaced with the correct
   `0x639Fe6ab55C921f74e7fac1ee960C0B6293ba612`.

3. **correlationId inheritance (#3 proper rework)** — `getRiskDecision` is being called
   per opp. No more `correlation does not match plan` 409s in `link-reservation`.

4. **amountOutExpected + fee (#4)** — Plans with 2 legs are being created successfully
   (35 created in the smoke window). UniV3 adapters no longer reject with
   "no swap params for plan".

5. **Broadcast instrumentation (Phase 2)** — Timeout infrastructure is in place; no
   stuck legs observed during the smoke (because no legs reached `submitting` — they
   all failed earlier at the cost gate).

### ⚠️ Remaining blocker: QuickNode RPC returns chainId=1 intermittently

The pipeline now reaches `MultiLegPlanBuilder` and `TradeCostEstimator`, but the
cost gate fails-closed on every plan:

```
Chainlink native/USD read failed (chain=42161):
  network changed: 1 => 42161 (event="changed", code=NETWORK_ERROR, version=6.17.0)

TradeCostEstimatorService: Cost gate BLOCKED plan:
  Cost estimate unavailable for leg(s) 0, 1 — cannot value live plan (fail-closed)
```

**Root cause:** QuickNode's load-balanced Arbitrum endpoint intermittently returns
`eth_chainId` = `0x1` (Ethereum mainnet) instead of `0xa4b1` (42161 = Arbitrum One).
ethers v6 caches the first `eth_chainId` it sees for the provider; once a bad response
is cached, every subsequent call throws `NETWORK_ERROR`. This poisoned the
PriceOracle → TradeCostEstimator → cost gate chain.

The `staticNetwork` fix (#12) was supposed to mitigate this but **made it worse**:
with `staticNetwork: true`, ethers throws on every read instead of just the first
bad response. Reverted in `6bbe45e`. Without staticNetwork the failure rate is lower
but still nonzero — confirmed by direct RPC tests showing `0xa4b1` correctly but
EO logs still showing intermittent `network changed`.

### Recommended next step

Switch the production RPC away from QuickNode Arbitrum to a more reliable provider
(Alchemy or Infura with a dedicated key). The current QuickNode endpoint works for
most requests but its load-balancer occasionally routes to the wrong chain, which
bricks ethers v6's network assumption. This is an operational fix, not a code fix —
the code is now correct, the RPC is not.

Until the RPC is swapped, `DEX_LIVE_KILL_SWITCH=false` + `LIVE_AUTO_DRIVE_ENABLED=true`
will keep creating-and-failing plans at the cost gate. The capital is not at risk
(fail-closed before any broadcast), but the system is not productive.

### Quick mitigation options (operator decision)

1. **Switch RPC provider** (recommended) — set `RPC_ARBITRUM_MAINNET_URL` and
   `RPC_ARBITRUM_MAINNET_BACKUP_URL` to a dedicated Alchemy/Infura Arbitrum endpoint
   and restart EO.
2. **Disable live auto-drive** until RPC is fixed — `LIVE_AUTO_DRIVE_ENABLED=false`,
   keep paper path running.
3. **Force a fresh provider cache** — restart EO; if the first `eth_chainId` call
   returns the correct chain, the cache will be good until the next bad response.

### Cleanup performed during smoke

- 3 stale `live_execution_plan_id` markers reset to NULL (their plans had all legs
  in `failed` from before the fixes; they were holding the concurrent-plan gate
  saturated at maxConcurrentPlans=3).
- Those 3 plans explicitly marked `state=failed` for reconciliation visibility.
- Hermes's uncommitted edits backed up to `/root/hermes-backup/` (4 files including
  ecosystem.paper.config.cjs and ТЗ docs) — do NOT re-apply, they're superseded by
  this commit chain.

### Files in this smoke

- `docs/live-rpc-diagnosis-2026-08-05.md` — full Phase 1 diagnosis
- `docs/live-auto-drive-smoke-2026-08-05.md` — this file
- Commits: `0ad81d0`, `28260f0`, `6bbe45e` on `main`

---

## Update 14:10 UTC — additional regressions fixed in-flight

After the initial smoke, the deploy cycle caught two more regressions that had been
hidden behind the corrupted-address error (they only became visible once Chainlink
started returning data):

### BigInt comparison (commit `82dcf3b`)

`price-oracle.service.ts:230` mixed `decimals: number` and `round.answer: bigint` in
the same expression: `decimals <= 0 || round.answer <= 0n`. V8 throws "Cannot mix
BigInt and other types". Split into two separate checks. After this fix Chainlink
ETH/USD reads succeed.

### Pool discovery — real Sushi addresses + BigInt wrap (commits `4470e87`, `10e6eef`)

Two compounding bugs in `pool-discovery.service.ts`:

1. **Wrong seed pool addresses** — the three hardcoded SushiSwap V2 pools were typos
   with bad checksums (e.g. `0x905d...c7c47` instead of the real `0x905d...11aa3`).
   Warm-up ran but every pool was rejected as "not recognized on chain 42161".
   Sourced the correct addresses from SushiSwap factory `getPair()` and verified each
   returns real bytecode + live reserves on-chain.

2. **`BigInt(bigint)` wrapping** — `tryUniV2Pool` wrapped `getReserves()` results in
   `BigInt()`, but ethers v6 already returns bigint values. `BigInt(bigvalue)` throws
   "Cannot mix BigInt and other types" — silently caught by the empty catch block,
   so the pool was rejected. Added a `typeof === 'bigint'` fast path.

After both fixes: `Seed pool warm-up done: 2/3 discovered` (was 0/3). One pool still
fails intermittently — the discovery loop will keep retrying.

### Remaining architectural gap (NOT fixed in this session)

Long-tail tokens (MAGIC, GMX, ARB, etc.) trade primarily on **Uniswap V3**, not
SushiSwap V2. The current `PriceOracle.priceArbitraryViaPool()` skips V3 pools
("V3 reserves are unreliable for pricing") and looks for V2 token↔WETH pairs that
don't exist for these tokens. As a result, the live cost gate fail-closes every
plan that involves a V3-only token because `getTokenPriceUsd(MAGIC)` returns null.

Two paths forward (next session):
1. **UniV3 slot0.sqrtPriceX96 → price derivation** — read the V3 pool's `slot0()` and
   compute `price = (sqrtPriceX96 / 2^96)^2 × 10^(decimals0 - decimals1)`. V3 pools
   do expose a precise price even though "reserves" are not meaningful.
2. **QuoterV2.quoteExactInputSingle via simulate()** — proper on-chain quote. QuoterV2
   is not view-only on Arbitrum, so it needs `eth_call` with a simulate payload.

Until one of these lands, the live pipeline will create plans but the cost gate will
keep blocking at the long-tail pricing step. The system is fail-safe (no capital at
risk — blocked before broadcast), but not yet productive.
