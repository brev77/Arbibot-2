# ADR: Vault master-key salt configurability

**Status:** accepted
**Date:** 2026-08-01
**Step:** `P7-6-VAULT-SALT` ([`.cursor/plans/DEVELOPMENT_PLAN7.md`](../.cursor/plans/DEVELOPMENT_PLAN7.md))
**Vector:** `SEC` — [`docs/roadmap-vectors.md`](roadmap-vectors.md) initiative #6
**Closes:** `TODO.md` H1, L3

## Context

`KeyVaultService` encrypts wallet private keys at rest (AES-256-GCM) and
persists the ciphertext to the `wallet_keys` table. The master encryption key is
derived once in the constructor:

```ts
const salt = 'arbibot-vault-salt-v1';                          // hardcoded
this.encryptionKey = scryptSync(encryptionKeyHex, salt, 32);    // master key
```

Per-key encryption is already correct — each key uses a random salt
(`randomBytes(32)`) and IV. The residual risk (H1, narrowed to Medium
2026-07-17) is that the **master-key** derivation salt is a constant committed
to source. An attacker who obtains the source (the repo is public) plus the
`PRIVATE_KEY_ENCRYPTION_KEY` can reproduce the master key exactly; with a
unique-per-deploy salt they would also need that deploy's salt value.

## Decision

Make the master-key salt configurable via `VAULT_MASTER_KEY_SALT`, **with a
backward-compatible fallback** to the historical constant when the env var is
unset:

```ts
const VAULT_SALT_FALLBACK = 'arbibot-vault-salt-v1';
const salt = process.env.VAULT_MASTER_KEY_SALT ?? VAULT_SALT_FALLBACK;
```

- **Production fails closed.** `tools/validate-env.sh` now REQUIRES both
  `PRIVATE_KEY_ENCRYPTION_KEY` (also closes L3) and `VAULT_MASTER_KEY_SALT`, and
  rejects the historical fallback value explicitly. So a prod deploy cannot
  accidentally run with the committed constant.
- **Dev/tests keep working.** The fallback preserves the historical salt, so
  existing encrypted keys in dev DBs and the test suite keep decrypting without
  any data migration.

### Why not migrate existing keys / why not KMS now

- **No live wallet keys exist yet.** The project is at the paper→live gate; no
  real private keys are persisted in any production `wallet_keys` table. So the
  "re-encrypt on salt change" problem is theoretical for now, and the fallback
  exists purely as a safety net + dev convenience.
- **KMS is the longer-term target** (HashiCorp Vault Transit, AWS KMS), tracked
  separately. This ADR is the minimal increment that closes H1 without the
  operational weight of a KMS migration before live.

## Consequences

- **Positive:** Each prod deploy can (and must) use a unique salt, so the
  committed constant no longer weakens the master-key derivation. H1 closed.
- **Positive:** Backward compatible — no data migration, no broken dev DBs, no
  spec churn (89/89 tests green).
- **Negative — salt change is breaking.** Changing `VAULT_MASTER_KEY_SALT` on a
  DB that already has encrypted keys breaks their decryption (the derived master
  key changes; GCM auth tag fails). Mitigation: rotate keys
  (`docs/key-rotation-runbook.md`) before changing the salt on an existing
  deploy. This is explicitly tested (`does NOT decrypt under another salt`).
- **Negative:** Two code paths (env salt vs fallback). Mitigated by the prod
  validator failing closed and a `logger.warn` when the fallback is used.

## Alternatives considered

- **Hard-remove the fallback, require the env var always.** Rejected — would
  break dev workflows and tests that don't set the var; the fallback is harmless
  given the prod validator gates it.
- **Migrate to KMS / Vault Transit now.** Rejected for P7-6 scope — KMS is a
  larger operational change tracked separately; this ADR is the minimal H1
  closure.
- **Random salt per process start, stored alongside the key.** Rejected — would
  require a schema change and a re-encryption flow; equivalent to key rotation,
  not worth it before any live keys exist.

## Verification

- `packages/nest-platform/src/vault/key-vault.service.spec.ts` — 4 new tests
  (fallback round-trip, custom-salt round-trip, cross-salt decrypt fails,
  restart consistency): 89/89 suite green.
- `tools/validate-env.sh` — `PRIVATE_KEY_ENCRYPTION_KEY` + `VAULT_MASTER_KEY_SALT`
  required in prod; historical value rejected (`bash -n` OK).
