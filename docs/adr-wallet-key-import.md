# ADR: Wallet-key import surface (CLI-first)

**Status:** accepted — `P8-3-WALLET-KEY-IMPORT` (PLAN8)
**Date:** 2026-08-02
**Plan step:** [`P8-3-WALLET-KEY-IMPORT`](../.cursor/plans/DEVELOPMENT_PLAN8.md)
**Related:** [`docs/adr-live-gate.md`](adr-live-gate.md) §4 (key management, L4), [`docs/vault-integration-guide.md`](vault-integration-guide.md), [`docs/key-rotation-runbook.md`](key-rotation-runbook.md)

## Context

The audit on 2026-08-02 (P8-3) found that `KeyVaultService.registerWalletKey` / `encryptPrivateKey` exist and are exercised by key *rotation*, but there is **no operator-facing surface to import a wallet key in the first place**. The only path to populate `wallet_keys` for live was a direct SQL `INSERT` — no validation that the derived address matches the stated one, no audit entry, no encryption-format guarantee, and the operator would have to hand-craft the AES-256-GCM blob. For a system that moves real capital, this is unsafe: a typo'd address silently binds the wrong wallet to a `key_id`, and the encrypted blob could be malformed and only fail at decrypt time (mid-trade).

This blocks the live path: step 6 of `docs/paper-deploy-aeza.md` §«Путь к live-фазе» says «Ввести wallet keys через operator UI/CLI (НЕ через чат/SSH)» — but no such UI/CLI existed.

## Decision

**CLI-first.** Provide `tools/wallet-key-import.mjs` (`npm run wallet:import`) as the primary import surface. A UI (`/wallets` page + BFF) is explicitly **deferred** (see Alternatives).

### What the CLI does

1. **Reads the private key from stdin (piped) or `WALLET_PRIVATE_KEY` env, never from argv.** Args are visible in `ps`/process listings; stdin and env are not. Interactive prompt exists as a fallback but is discouraged (input is visible in the terminal).
2. **Validates the format** — 64 hex chars, with or without `0x` prefix (mirrors `KeyVaultService.isValidPrivateKey`).
3. **Derives the address** with `ethers.computeAddress` (the same library/version the execution path uses) and, when `--expected-address` is supplied, **fails closed** on mismatch. This catches the "wrong key / typo'd address" class of mistake before any persistence.
4. **Encrypts with AES-256-GCM** using the same algorithm parameters as `KeyVaultService.encryptPrivateKey` (scrypt-derived key, 16-byte IV, 32-byte per-key salt, GCM authTag appended). The ciphertext is byte-compatible with what the service decrypts at `selectWallet` time.
5. **Binds to the deploy** via `VAULT_MASTER_KEY_SALT` (P7-6): the combined salt = `<deploySalt> + <perKeySalt>`, so a ciphertext encrypted on deploy A cannot be decrypted on deploy B even if `PRIVATE_KEY_ENCRYPTION_KEY` is identical.
6. **`INSERT`s into `wallet_keys`** with idempotency: refuses to overwrite an existing `key_id` (rotation uses a *new* `key_id`; see key-rotation-runbook).
7. **Never logs the plaintext key.** Only the derived address, `key_id`, `chain_id`, and algorithm are printed.

### Threat model (K1/K2 from `dex-security-and-capital-safety`)

| Threat | Mitigation |
|--------|------------|
| **K1 — decrypted key logged** | Plaintext is read into a local `const`, used for address-derivation + encryption, then the binding goes out of scope. It is never passed to `console.*`, never to an HTTP body, never to an arg. |
| **K2 — `decryptPrivateKey` outside vault** | N/A for import (we *encrypt*, not decrypt). The CLI's `encryptPrivateKey` is a faithful re-implementation of `KeyVaultService.encryptPrivateKey` (same algorithm, same params); it does not touch the service's decrypt path. |
| **Key visible in `ps`** | Key comes from stdin/env, never argv. |
| **Key in shell history** | Pipe form (`echo "0x..." | npm run wallet:import`) leaves no history entry with the key; the prompt form warns it is visible. `WALLET_PRIVATE_KEY=... npm run wallet:import` may leave an entry — prefer the pipe form or `read -s` wrapper. |
| **Wrong key bound to `key_id`** | `--expected-address` fails closed on mismatch (derived ≠ stated). |
| **Malformed ciphertext** | CLI uses the exact `KeyVaultService` algorithm; a `--dry-run` mode encrypts without writing, so the operator can verify the round-trip before commit. |
| **`wallet_keys` overwrite during rotation** | INSERT refuses existing `key_id`; rotation = new id + deactivate-old flow (key-rotation-runbook). |

## Alternatives considered

### A. Operator UI (`/wallets` page + BFF `POST /api/operator/wallets`)
**Rejected for v1.** Reasons:
- HTTP request bodies are logged by reverse proxies (nginx access logs, Fastify request logs) → the key would land in logs unless every layer is carefully configured to redact. The CLI keeps the key on the operator's host.
- Requires operator session + RBAC admin + a new controller on execution-orchestrator that exposes a key-accepting endpoint — a larger attack surface than a CLI run from SSH.
- Single-operator paper→live deployment: the operator already SSH's to the host for other setup; a CLI is the natural fit.

**Deferred, not cancelled.** A UI can be added later (Phase: multi-operator) — it would POST to a controller that runs the same encrypt+insert logic, with the additional burden of log-redaction and a typed-phrase confirm. The CLI remains the trusted fallback.

### B. Direct SQL `INSERT` (status quo)
**Rejected.** No address validation, no encryption-format guarantee, no audit. This is exactly the gap P8-3 closes.

### C. HashiCorp Vault Transit (envelope encryption)
**Out of scope for v1 live.** `docs/vault-integration-guide.md` §3.3 already documents the Phase-C path: Vault Transit encrypts, `wallet_keys` stores the Vault ciphertext. The CLI's local AES-256-GCM is the v1; Vault is v2 when capital scales. The CLI's `encryptPrivateKey` function would be swapped for a Vault Transit call — the rest of the flow (read, validate, derive address, INSERT) is unchanged.

## Consequences

- **New tool:** `tools/wallet-key-import.mjs`, `npm run wallet:import`. Depends on `pg` + `ethers` (both already workspace deps).
- **Required env at import time:** `DATABASE_URL`, `PRIVATE_KEY_ENCRYPTION_KEY`, `VAULT_MASTER_KEY_SALT` (all already required by execution-orchestrator at runtime — no new secrets).
- **No schema change:** uses the existing `wallet_keys` table (migration 042).
- **Single-writer preserved:** the CLI writes the same row shape that `TypeOrmWalletKeyStore` would; execution-orchestrator remains the only service that *reads+decrypts*. The CLI is an operator tool, not a service.
- **Restart may be needed:** `KeyVaultService.metaCache` is in-memory; after a CLI import the service may need a restart (or key-meta reload) to pick up the new key. Documented in the CLI output.

## Operational notes

- **Import then verify:** always run with `--expected-address` set to the address the operator generated the key for. The fail-closed mismatch check is the primary defence against wrong-key binding.
- **`--dry-run` first:** encrypts without writing; confirms the algorithm + derived address before any DB change.
- **Rotation = new `key_id`:** never overwrite. Deactivate the old key (`is_active = false`) and import the new one under a new id; see [`docs/key-rotation-runbook.md`](key-rotation-runbook.md).
- **Backup exclusion:** `wallet_keys` is encrypted-at-rest but should be excluded from standard `pg_dump` (migration 042 note); keep a separately managed encrypted backup of key material.

## Links

- Plan: [`.cursor/plans/DEVELOPMENT_PLAN8.md`](../.cursor/plans/DEVELOPMENT_PLAN8.md) §P8-3
- Related ADR: [`docs/adr-live-gate.md`](adr-live-gate.md) §4 (L4 key management)
- Runbook: [`docs/key-rotation-runbook.md`](key-rotation-runbook.md)
- Vault guide: [`docs/vault-integration-guide.md`](vault-integration-guide.md)
- Threat model: `.cursor/skills/dex-security-and-capital-safety/references/threat-model.md` (K1, K2)
