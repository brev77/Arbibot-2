# ADR: Live-gate architecture (kill-switch + limits + capital ceiling + keys + bridge + mTLS + secret-scan + two-person)

**Status:** accepted — target for `D4-B-1` … `D4-B-8` (Фаза B, Plan 4)  
**Date:** 2026-07-12  
**Supersedes:** «control exists only in docs/seed» state for L1–L8 from [`docs/deployment-readiness-review-2026-07.md`](deployment-readiness-review-2026-07.md) §3  
**Plan step:** [`D4-B-0-LIVE-ADR`](../.cursor/plans/deploy-readiness/D4-B-0-LIVE-ADR.md) → `D4-B-1`…`D4-B-9`

## Context

The deployment-readiness review (2026-07) found 8 capital-critical blockers (L1–L8) where a control is described in documentation, seed data, or frontend code but is **absent from the backend execution path**. For a system that will move real capital, each of these is a direct path to fund loss. This ADR fixes the architecture for all of them **before** implementation, so steps D4-B-1…D4-B-8 implement against a single coherent design rather than ad-hoc.

**Canonical principle (from the review):** live-path controls must be enforced **in the backend, in the execution path**, not in the UI. UI controls are convenience, not security.

## Current-state inventory (verified 2026-07-12)

| # | Blocker | Current state | file:line |
|---|---------|---------------|-----------|
| L1 | Kill-switch | **Not enforced.** `killSwitch` / `DEX_LIVE_KILL_SWITCH` have **zero** backend matches; env var only in templates; UI writes the flag but nothing reads it. Live leg goes out at `LegsService.markSent` → `venue.submitLeg` with no guard. | `apps/execution-orchestrator/src/legs/legs.service.ts:293`; `apps/execution-orchestrator/src/venue/http-venue.adapter.ts:178` |
| L2 | `dex.limits`/`dex.live` not consumed | **Hardcoded.** `DexRiskPolicyService` uses `maxPositionSizeUsd:10000` etc. + in-memory `dailyVolume` Map (resets on restart); `evaluateTrade()` has **zero callers** despite being exported. Migration 035 seeds both keys; only frontend reads them. | `apps/execution-orchestrator/src/execution/risk/dex-risk-policy.service.ts:45-57,70` |
| L3 | No aggregate capital ceiling | `reserve()` writes a row + outbox unconditionally; no `SELECT SUM(...) FOR UPDATE` against a ceiling; no ceiling config key. | `apps/capital-service/src/capital/capital.service.ts:36-98` |
| L4 | Keys in-memory; no HSM/KMS/Vault | Vault is a process-local `Map`; decrypted `ethers.Wallet` cached for process lifetime; `PRIVATE_KEY_ENCRYPTION_KEY` commented out in prod template. | `packages/nest-platform/src/vault/key-vault.service.ts:45-49`; `apps/execution-orchestrator/src/execution/wallet-manager.service.ts:61-62,124-130`; `.env.production.example:113-114` |
| L5 | Bridge adapters no finality | Source-side `tx.wait(1)` exists; destination-side `checkBridgeStatus` is a `'pending'` **stub** in all 3 adapters; `destinationTxHash`/`confirmations` never produced. | `apps/execution-orchestrator/src/execution/bridge/across-bridge.adapter.ts:229-240` (+ Stargate `:226`, Native `:171`) |
| L6 | mTLS / service-auth opt-in off | HMAC guard gated on `ARBIBOT_SERVICE_AUTH_ENABLED==='true'`; default off; flag **absent** from `.env.production.example`. | `packages/nest-platform/src/service-auth/fastify-guard.ts:140-142` |
| L7 | secret-scan non-blocking | `secret-scan` CI job has `continue-on-error: true`. | `.github/workflows/ci.yml:23-34` |
| L8 | Two-person approval not enforced | Single-operator typed phrase ("CONFIRM") in UI; `requireTwoPersonApproval` seeded `true` but **no backend consumer**; direct API call bypasses the UI. | `apps/web/components/domain/destructive-operator-action.tsx:31,61-71`; `infra/postgres/migrations/035_dex_live_limits_seed.sql:38` |

## Decision (target architecture)

### 1. Kill-switch (L1) — `D4-B-1`

- **Mechanism:** a new `DexKillSwitchService` in `execution-orchestrator` that exposes `isLiveKilled(): Promise<boolean>`, invoked as the **first** check inside `LegsService.markSent` before `this.venue.submitLeg(...)` and before `BridgeTransferService.submitBridgeTransfer(...)`.
- **Source of truth (precedence, highest first):**
  1. `DEX_LIVE_KILL_SWITCH=true` env override (operator emergency — no config-service round-trip, takes effect on next leg).
  2. config-service `GET /policy/configurations/dex.limits/effective` → `killSwitch: true` (seeded by migration 035; set via UI / operator API).
- **Caching:** `<5ms` budget — the effective config is cached (reuse the Phase-4 `PolicyCacheService` pattern: 61–300s TTL); the env override is a direct `process.env` read.
- **Fail-state:** **fail-closed for live.** If the config read errors AND no cached value exists, live legs are blocked (`throw`), paper legs continue. Emit a metric + Alertmanager alert (`DEXLiveBlockedTotal`, paging severity).
- **Paper isolation:** the guard is **only** on the live path (`venue.submitLeg` / bridge submit). Paper-trading-service legs never reach `LegsService.markSent`, so they are unaffected by definition.
- **Race with in-flight legs:** the kill-switch is checked **per leg before submit**. An already-submitted in-flight leg runs to completion (we cannot un-broadcast a tx); subsequent legs in the same plan are blocked. Documented as accepted behaviour.

### 2. `dex.limits` / `dex.live` consumption (L2) — `D4-B-2`

> **Implementation complete (2026-07-14).** Sub-steps 2a/2b/2c/2d landed in commits `e2dd527` / `27ff8eb` / `368e50e` / *(2d)*. All 5 live DEX adapters now pass through `evaluateTrade()` before wallet selection; `recordTradeVolume()` runs after `tx.wait()` success; `PaperDexAdapter` is structurally isolated (no risk-gate deps). Tests: 494/494, build + lint green. See `.cursor/plans/deploy-readiness/D4-B-2-LIMITS.md`.

- **Config reader:** `DexRiskPolicyService.getEffectiveConfig()` reads config-service `dex.limits`/`dex.live` effective (cached) instead of the hardcoded defaults; env vars (`DEX_MAX_*`) remain as **lower-bound overrides** only (env can tighten, never loosen, the config value).
- **`evaluateTrade()` wired in:** every DEX adapter (`uniswap-v2`, `uniswap-v3`, `sushiswap-v2`, `pancakeswap-v2`, `biswap-v2`) calls `dexRiskPolicy.evaluateTrade({...})` before `selectWallet`, throwing on `deny`. The single insertion point is the adapter's swap entry; bridge legs are gated by the kill-switch + their own finality (L5), not `evaluateTrade`. Fail-closed: an unresolved `tokenIn` USD price (price oracle → `null`) throws before broadcast.
- **`recordTradeVolume()` wired in:** each adapter calls it after a successful `tx.wait()` (non-fatal — the swap is already broadcast; any persistence failure is logged inside the service).
- **Daily volume persisted:** the in-memory `dailyVolume` Map moves to a Postgres table (`dex_daily_volume` keyed by `chain_id, trade_date`) updated via atomic UPSERT; survives restart. Migration in `D4-B-2a`.
- **Paper/live isolation:** `PaperDexAdapter` has a zero-arg constructor and never imports `DexRiskPolicyService` / `PriceOracleService` (structural guard in `paper-dex.adapter.spec.ts`).
- **Defaults:** migration 035 already seeds safe defaults (`enabled:false`, `liveEnabled:false`, `dryRunMode:true`) — these remain until product-owner explicitly enables live.

### 3. Aggregate capital ceiling (L3) — `D4-B-3`

- **Mechanism:** inside `capital.service.reserve()` transaction, before the insert, run `SELECT COALESCE(SUM(amount_usd),0) AS active_total FROM capital_reservations WHERE state='active' FOR UPDATE;` and assert `active_total + dto.amountUsd <= ceiling`. Throw `CapitalCeilingExceeded` (→ 422 to caller) on violation.
- **`FOR UPDATE`** on the aggregate row set serializes concurrent reservations and closes the C1 race.
- **Ceiling source:** new config key `capital.limits` (seeded by a new migration): `{ maxActiveCapitalUsd, maxDailyNotionalUsd }`. Fallback: env `CAPITAL_MAX_ACTIVE_USD` (fail-closed if neither set in prod).
- **Metric:** `arb_capital_ceiling_used_ratio` gauge (`active_total / ceiling`) for Alertmanager.

### 4. Key management (L4) — `D4-B-4`

- **Persistence:** move `KeyVaultService.encryptedKeys` from the process-local `Map` to a Postgres table (`wallet_keys` keyed by `key_id`, AES-256-GCM ciphertext + nonce + tag as today). The `keys` plaintext registry is **removed** (decrypted keys never persisted, only the encrypted blob).
- **Wallet cache lifetime:** `WalletManagerService.walletCache` gets a TTL (default 60s, env `WALLET_CACHE_TTL_MS`) + explicit eviction on key rotation; decrypted `ethers.Wallet` no longer held for process lifetime.
- **Master key:** `PRIVATE_KEY_ENCRYPTION_KEY` added (uncommented, `<CHANGE_ME_USE_VAULT>`) to `.env.production.example` + `validate-env.sh`; fail-fast in the constructor stays.
- **Non-goal for paper-deploy→minimal-live:** HSM/KMS/HashiCorp Vault integration stays as the documented live-gate extension path (see `docs/vault-integration-guide.md`). The DB-backed encrypted store is the v1 hardening; KMS is the v2 when capital scales. This is explicitly accepted by product-owner because the alternative (no DB store) is worse.

### 5. Bridge finality (L5) — `D4-B-5`

- **Destination polling:** each adapter's `checkBridgeStatus` replaces the `'pending'` stub with real on-chain reads:
  - **Across:** `SpokePool.filledDeposits(depositId)` event scan.
  - **Stargate:** LayerZero messaging status (`dstChainId`, `guid`).
  - **Native:** per-chain official bridge event/topic.
- **Finality thresholds (B3):** per-chain `requiredConfirmations` (e.g. Ethereum mainnet 12, Optimism/Arbitrum 2000+, Base ~2000) from a config map; a transfer is `completed` only when `confirmations >= threshold`.
- **Idempotent claim (B1):** destination-side fill is keyed by `sourceTxHash + depositId` (unique constraint), so a replayed poll cannot double-process.
- **Timeout:** existing `BridgeTransferService` timeout detection stays; add `expired` → operator-approve manual recovery.

### 6. mTLS / service-to-service auth (L6) — `D4-B-6`

- **Decision:** enforce the existing **HMAC** guard (`ARBIBOT_SERVICE_AUTH_ENABLED=true` by default in prod), not full mTLS. Rationale: HMAC is already implemented, tested, and covers the threat (any container in `arbibot-backend` calling any service); mTLS adds cert-rotation overhead disproportionate to a single-host paper-deploy.
- **Enforcement:** `.env.production.example` sets `ARBIBOT_SERVICE_AUTH_ENABLED=true` + `ARBIBOT_SERVICE_AUTH_SECRET=<CHANGE_ME_USE_VAULT>`; `validate-env.sh` fails if absent in prod; all internal clients sign outbound requests via `fetch-signer.ts`.
- **Extension path (live scale):** mTLS via mutual cert-manager when multi-host. Documented, not implemented now.

### 7. Secret-scan blocking (L7) — `D4-B-7`

- **Decision:** flip `continue-on-error: false` on the `secret-scan` job once a green baseline holds.
- **Ordering:** first land the green baseline (verify `tools/ci-key-leakage.sh` exits 0 on current `main`), then flip the flag in the same PR. If pre-existing findings exist, fix them first (the guard excludes `*.spec.ts`/`*.d.ts`/`dist`/mocks, so only production `.ts` matters).
- **Complement:** `.github/gitleaks-config.toml` (value guard) stays as the second layer; the K1/K2 grep guard is the pattern layer.

### 8. Two-person approval (L8) — `D4-B-8`

- **Backend state machine:** when `dex.limits.requireTwoPersonApproval` is `true`, a live/destructive action enters `approval_requested` state with the **first operator's** id; a **second, distinct** operator transitions it to `approved` via a separate authenticated call; only then does the execution path proceed. Both operator ids + timestamps audited.
- **Scope of "destructive":** live leg submit, manual force-hedge, kill-switch toggle, capital ceiling override. Not: read APIs, paper legs.
- **Two distinct operators:** enforced by `requesterOperatorId !== approverOperatorId` (same operator cannot self-approve). The existing `OperatorSession` (`sub` claim from `D4-A-1-AUTH`) provides the verified identity.
- **UI:** the `DestructiveOperatorAction` component gains a "request approval" → "approve (second operator)" two-step flow; but the backend is the enforcer (direct API cannot bypass).

## Decision criteria (constraints all substeps must satisfy)

- **Paper/live isolation:** every live-gate control is on the live path only. Paper-trading-service and paper legs are structurally unable to reach the gated code, so the controls cannot regress paper behaviour.
- **Latency budget:** kill-switch check `<5ms` (cached config); `evaluateTrade` `<10ms`; capital-ceiling `SUM...FOR UPDATE` inside the existing reservation tx (no extra round-trip).
- **Backward-compatibility:** every new config key has a safe default (`enabled:false` / `liveEnabled:false` / ceiling unset → fail-closed). No migration breaks existing rows.
- **Fail-closed over fail-open:** on any unreadable config / unreachable dependency, the live path blocks (paper continues). Never silently allow.

## Edge cases & accepted behaviour

| Case | Decision |
|------|----------|
| Race: operator flips kill-switch while a leg is in-flight | In-flight leg completes (cannot un-broadcast); subsequent legs blocked. Accepted. |
| config-service unreachable at leg submit | Kill-switch: fail-closed (block live). Limits/ceiling: fail-closed. Paper: continues. Metric + alert fired. |
| Daily-volume table write fails mid-leg | Leg transition rolls back (same tx) — no volume accounting drift. |
| Bridge poll sees confirmations then chain reorg | Re-check confirmations on next poll; `completed` state is reversible to `pending` until `confirmations >= threshold + reorgBuffer`. |
| Two-person: same operator opens two sessions to self-approve | Rejected — enforced by `operatorId` equality check on the verified `sub` claim, not by session cookie count. |
| `PRIVATE_KEY_ENCRYPTION_KEY` missing in prod | Constructor throws (existing behaviour) — container fails to start. `validate-env.sh` catches it pre-deploy. |

## Consequences

- **New work:** D4-B-1 (kill-switch service), D4-B-2 (config reader + adapter wiring + `dex_daily_volume` migration), D4-B-3 (ceiling + `capital.limits` migration), D4-B-4 (DB-backed vault + wallet TTL + env), D4-B-5 (3 adapter finality impls), D4-B-6 (env + validate), D4-B-7 (CI flag), D4-B-8 (approval state machine + migration + UI).
- **New migrations:** `dex_daily_volume` (D4-B-2), `capital.limits` seed (D4-B-3), `wallet_keys` (D4-B-4), approval-state table (D4-B-8) — all sequential `039_…` onward (038 taken).
- **Tests:** each substep adds unit tests for its control (kill-switch deny, ceiling overflow, two-person distinct-operator, etc.).
- **No architectural boundary change:** all controls live in their owning service (kill-switch/limits/bridge in execution-orchestrator, ceiling in capital-service, keys in nest-platform + wallet-manager, approval state machine in the executing service). Single-writer principle preserved.

## Implementation order (from dependency graph)

```
D4-B-0 (this ADR) ─┬─→ D4-B-1 (kill-switch) ─→ D4-B-2 (limits, reuses kill-switch infra)
                   ├─→ D4-B-3 (ceiling)
                   ├─→ D4-B-4 (keys)
                   ├─→ D4-B-5 (bridge)
                   ├─→ D4-B-6 (mTLS)
                   └─→ D4-B-8 (two-person)
D4-B-7 (secret-scan, parallel — no B-0 dep)
D4-B-9 (import-graph, parallel — no B-0 dep)
```

`D4-B-2` depends on `D4-B-1` (limits uses the kill-switch's cached-config-service infra); the rest of B-1…B-8 are parallel after this ADR.

## Links

- Source review: [`docs/deployment-readiness-review-2026-07.md`](deployment-readiness-review-2026-07.md) §3 (L1–L8)
- Threat model: `.cursor/skills/dex-security-and-capital-safety/references/threat-model.md` (C1, C2, B1, B3)
- Operator auth (identity for two-person): [`docs/adr-operator-auth.md`](adr-operator-auth.md)
- Plan: [`.cursor/plans/DEVELOPMENT_PLAN4.md`](../.cursor/plans/DEVELOPMENT_PLAN4.md) — Фаза B
