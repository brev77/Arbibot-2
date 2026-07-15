import type { EncryptedKey } from './key-vault.service';

/**
 * Nonsensitive wallet-key metadata cached in memory and read synchronously
 * by KeyVaultService consumers (dex-health checks, wallet selection).
 *
 * This intentionally excludes the encrypted payload — the ciphertext blob is
 * fetched on demand from {@link WalletKeyStore.getEncryptedKey} and never held
 * in the metadata cache.
 */
export interface WalletKeyRecord {
  keyId: string;
  address: string;
  chainId: number;
  isActive: boolean;
  createdAt: Date;
  lastUsedAt?: Date;
}

/**
 * Persistence port for wallet keys (D4-B-4-KEYS, hexagonal architecture).
 *
 * KeyVaultService depends on this abstraction (optionally, via DI) instead of a
 * concrete storage. The production adapter (TypeOrmWalletKeyStore in
 * execution-orchestrator) persists to the `wallet_keys` table; the in-memory
 * fallback is used in dev/test when no adapter is registered.
 *
 * Contract: every method reads/writes the AES-256-GCM ciphertext blob only.
 * Plaintext private keys never cross this boundary — they exist solely inside
 * KeyVaultService.decryptPrivateKey (K2 leakage-guard owner).
 */
export interface WalletKeyStore {
  /** Upsert key metadata (address, chainId, active flag). Idempotent by keyId. */
  saveKeyMeta(record: WalletKeyRecord): Promise<void>;

  /** Read a single key's metadata, or null when absent. */
  getKeyMeta(keyId: string): Promise<WalletKeyRecord | null>;

  /** All active+inactive keys (used by health checks). */
  getAllKeyMeta(): Promise<WalletKeyRecord[]>;

  /** All keys (active+inactive) for a chain. */
  getKeysByChain(chainId: number): Promise<WalletKeyRecord[]>;

  /** Persist (or overwrite) the encrypted payload for a keyId. Idempotent. */
  saveEncryptedKey(keyId: string, encryptedKey: EncryptedKey): Promise<void>;

  /** Read the encrypted payload, or null when absent. Plaintext is never returned. */
  getEncryptedKey(keyId: string): Promise<EncryptedKey | null>;

  /** Flip the active flag (soft-delete / rotation). No-op when keyId absent. */
  setActive(keyId: string, isActive: boolean): Promise<void>;

  /** Record last-used timestamp. Best-effort; failures should not surface. */
  updateLastUsed(keyId: string, lastUsedAt: Date): Promise<void>;
}

/**
 * DI token for {@link WalletKeyStore}. Bound by the host app (execution-orchestrator)
 * to a concrete adapter. Optional — KeyVaultService falls back to in-memory when
 * unbound, which keeps nest-platform unit tests DB-free.
 */
export const WALLET_KEY_STORE = Symbol('ARBIBOT_WALLET_KEY_STORE');
