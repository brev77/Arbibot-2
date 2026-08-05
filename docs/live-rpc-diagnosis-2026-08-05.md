# Live RPC Diagnosis — 2026-08-05

**Host:** Aéza Frankfurt (79.137.202.225, SSH alias `arbibot-paper`)
**Trigger:** Hermes post-live-debugging report — `getCode(chainlinkFeed)=0x`, pipeline stall
**Investigator:** ZCode (post-Hermes audit session)

---

## TL;DR — Root Cause

**NOT an RPC problem.** The Arbitrum RPC (QuickNode paid endpoint) is healthy and returns correct data.
The failure is a **corrupted Chainlink price feed address** in `packages/contracts-eth/src/addresses/arbitrum.ts:57`.

```
chainlinkEthUsd: '0x639Fe6ab55C921f74e7fac1EE960C052051f9ef9',  // WRONG
```

The correct Chainlink ETH/USD proxy on Arbitrum One mainnet is:

```
0x639Fe6ab55C921f74e7fac1ee960C0B6293ba612
```

The two addresses share the first 28 chars (`0x639Fe6ab55C921f74e7fac1ee960c`) but diverge after —
the version in our repo was either mistyped or corrupted during copy-paste.

Compounding the typo, ethers v6 enforces **strict EIP-55 checksum**, so the mixed-case string
also fails the checksum check and throws `INVALID_ARGUMENT` before any RPC call happens.

---

## Diagnosis Trail (evidence)

### 1. Production env on Aéza — RPC config is correct

`/root/Arbibot-2/.env`:
```
RPC_ARBITRUM_MAINNET_URL=https://special-purple-mountain.arbitrum-mainnet.quiknode.pro/<key>/
```
QuickNode paid endpoint (not public). `RPC_ARBITRUM_TESTNET_URL` is absent (no testnet/mainnet mismatch).

### 2. Direct RPC checks against QuickNode endpoint (from Aéza)

| Method | Address | Result |
|---|---|---|
| `eth_chainId` | — | `0xa4b1` (42161 = Arbitrum One) ✅ |
| `eth_blockNumber` | — | `0x1d494d4e` (current) ✅ |
| `eth_getCode` | WETH `0x82aF…Bab1` | 4186 bytes ✅ |
| `eth_getCode` | USDC `0xaf88…5831` | 3706 bytes ✅ |
| `eth_getCode` | SushiRouter `0x1b02…7506` | 35526 bytes ✅ |
| `eth_getCode` | UniV3Router `0x68b3…Fc45` | 48996 bytes ✅ |
| `eth_getCode` | **Chainlink ETH/USD `0x639F…9ef9`** | **2 bytes (`0x`)** ❌ |
| `eth_call decimals()` | same | `0x` ❌ |

The QuickNode endpoint works perfectly for every other contract — including known-good Chainlink
ARB/USD feed (`0xb2A82…48D6`, decimals=8).

### 3. The "correct" candidate verified on-chain

```
CORRECT: 0x639fe6ab55c921f74e7fac1ee960c0b6293ba612
  → getCode: 19144 bytes ✅
  → decimals(): 0x...08 (= 8) ✅
  → latestRoundData(): real ETH price (≈ $1867 at time of check) ✅

WRONG (in our code): 0x639Fe6ab55C921f74e7fac1EE960C052051f9ef9
  → getCode: 2 bytes (0x)
  → ethers v6 ALSO rejects on checksum: "bad address checksum ... code=INVALID_ARGUMENT"
```

### 4. Smoking gun from EO logs on Aéza

`/root/.pm2/logs/execution-orchestrator-out.log` (last 24h), pattern repeats hundreds of times:

```json
{"level":"warn","context":"PriceOracleService",
 "msg":"Chainlink native/USD read failed (chain=42161): bad address checksum
        (argument=\"address\", value=\"0x639Fe6ab55C921f74e7fac1EE960C052051f9ef9\",
         code=INVALID_ARGUMENT, version=6.17.0) — trying DEX fallback"}
```

The error is `INVALID_ARGUMENT`, not `CALL_EXCEPTION` — ethers never sent the RPC call.
The "DEX fallback" Hermes added then also fails for the same checksum reason (the Sushi pool
address `0x57b85FEf094e10b5eeCDF350Af688299E9553378` is also a bad checksum).

### 5. The Chainlink address is corrupted, not just mis-checksummed

Even if you bypass the checksum by lowercasing, the underlying address is wrong:

```
lowercase(0x639Fe6ab55C921f74e7fac1EE960C052051f9ef9)
  → 0x639fe6ab55c921f74e7fac1ee960c052051f9ef9
  → still getCode = 0x on-chain (no contract deployed there)
```

This is a genuine typo in the address bytes, not just a case-formatting issue.

---

## Secondary findings

### Other corrupted Chainlink feeds in the same file

- `chainlinkUsdcUsd: '0x50834F3163468741E928E2838d6D35C6c75C56F9'` — bad checksum + on-chain empty
- `chainlinkUsdtUsd: '0x3f3f5dF88dC9F13eac4DF188Ce0FC83aB5F5e08'` — **41 hex chars** (truncated!) + bad checksum

These two are not consumed by PriceOracleService v1 (stables hard-coded to $1 via `isStable()`),
so they don't break live trading. But they're still corrupted and must be fixed or zeroed.

### Bad checksums across all four chain files

A repo-wide scan (`packages/contracts-eth/src/addresses/*.ts`) found **30+ addresses** with
either bad EIP-55 checksum or all-lowercase. ethers v6 silently accepts lowercase, so only the
mixed-case-but-wrong ones actually break — but the file should be checksum-canonical everywhere
to prevent future copy-paste bugs.

---

## Resolution

The fix is **one-line in code**: replace the corrupted Chainlink address with the correct one.

```ts
// arbitrum.ts:57
- chainlinkEthUsd: '0x639Fe6ab55C921f74e7fac1EE960C052051f9ef9',
+ chainlinkEthUsd: '0x639Fe6ab55C921f74e7fac1ee960C0B6293ba612',
```

Plus: recalculate EIP-55 checksums for all 30+ addresses across arbitrum/base/bnb/optimism files
(ethers `getAddress()` one-shot). USDC/USDT feeds set to `ZERO_ADDRESS` (matching Sepolia pattern)
until canonical addresses are sourced from Chainlink docs.

**This single fix unblocks live trading** — no RPC migration needed, no code restructuring.
The QuickNode endpoint was never the problem.
