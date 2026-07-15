import { Inject, Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';
import { AuditClientService } from '../audit-client.service';
import {
  WALLET_KEY_STORE,
  type WalletKeyRecord,
  type WalletKeyStore,
} from './wallet-key-store';

/**
 * Encrypted key representation
 */
export interface EncryptedKey {
  keyId: string;
  encryptedData: string;
  iv: string;
  salt: string;
  algorithm: string;
  createdAt: Date;
}

/**
 * Wallet key metadata
 */
export interface WalletKey {
  keyId: string;
  address: string;
  chainId: number;
  isActive: boolean;
  createdAt: Date;
  lastUsedAt?: Date;
}

/**
 * Key Vault Service
 * Step: DEX-1-0-VAULT (D4-B-4-KEYS: persistence refactor)
 *
 * Manages encryption/decryption of private keys with audit logging.
 * Keys are encrypted at rest (AES-256-GCM) and only decrypted during signing.
 *
 * D4-B-4-KEYS: the encrypted ciphertext blob is NO LONGER held in a long-lived
 * in-memory Map. It is persisted through the {@link WalletKeyStore} port
 * (production adapter → `wallet_keys` table) and read on demand. Nonsensitive
 * metadata (address, chainId, active flag) is kept in a read-through cache so
 * sync readers (dex-health checks, wallet selection) stay sync.
 *
 * Plaintext private keys live only inside {@link decryptPrivateKey} — the K2
 * leakage-guard contract is preserved (this file + wallet-manager.service.ts
 * are the sole owners of decryptPrivateKey / retrieveEncryptedKey).
 */
@Injectable()
export class KeyVaultService implements OnModuleInit {
  private readonly logger = new Logger(KeyVaultService.name);
  private readonly encryptionKey: Buffer;
  private readonly algorithm = 'aes-256-gcm';
  private readonly keyLength = 32; // 256 bits
  private readonly ivLength = 16; // 128 bits
  private readonly saltLength = 32; // 256 bits

  /**
   * Read-through cache of nonsensitive key metadata (address/chainId/isActive).
   * Hydrated from the store on init and kept in sync on every write. Sync readers
   * (dex-health) read from here. The ciphertext blob is NEVER cached — it is
   * fetched on demand from {@link retrieveEncryptedKey}.
   */
  private readonly metaCache = new Map<string, WalletKeyRecord>();

  // Performance metrics
  private encryptLatency = 0;
  private decryptLatency = 0;
  private encryptCount = 0;
  private decryptCount = 0;

  constructor(
    private readonly auditService: AuditClientService,
    @Optional() @Inject(WALLET_KEY_STORE) private readonly store?: WalletKeyStore,
  ) {
    const encryptionKeyHex = process.env.PRIVATE_KEY_ENCRYPTION_KEY;
    if (!encryptionKeyHex) {
      throw new Error('PRIVATE_KEY_ENCRYPTION_KEY environment variable is required');
    }

    // Derive encryption key from environment variable
    const salt = 'arbibot-vault-salt-v1';
    this.encryptionKey = scryptSync(encryptionKeyHex, salt, this.keyLength);
    this.logger.log(
      `Key Vault Service initialized (persistence: ${store ? 'wallet_keys table' : 'in-memory fallback'})`,
    );
  }

  async onModuleInit() {
    // Hydrate metadata cache from the store so sync readers see existing keys.
    // The in-memory fallback path has nothing to load (no store registered).
    if (this.store) {
      try {
        const records = await this.store.getAllKeyMeta();
        for (const r of records) {
          this.metaCache.set(r.keyId, r);
        }
        this.logger.log(`Loaded ${records.length} wallet key(s) from store`);
      } catch (error) {
        this.logger.error('Failed to hydrate wallet key cache from store:', error);
      }
    }
    this.logger.log('Key Vault Service ready');
  }

  /**
   * Encrypt a private key
   * @param privateKey - The private key to encrypt (hex string without 0x prefix)
   * @param keyId - Unique identifier for this key
   * @returns Encrypted key data
   */
  async encryptPrivateKey(privateKey: string, keyId: string): Promise<EncryptedKey> {
    const startTime = Date.now();

    try {
      // Validate private key format
      if (!this.isValidPrivateKey(privateKey)) {
        throw new Error('Invalid private key format');
      }

      // Generate random IV and salt
      const iv = randomBytes(this.ivLength);
      const salt = randomBytes(this.saltLength);

      // Derive key from master key + salt
      const derivedKey = scryptSync(this.encryptionKey, salt, this.keyLength);

      // Encrypt
      const cipher = createCipheriv(this.algorithm, derivedKey, iv);
      let encrypted = cipher.update(privateKey, 'utf8', 'hex');
      encrypted += cipher.final('hex');

      const authTag = cipher.getAuthTag();

      // Combine encrypted data + auth tag
      const encryptedData = encrypted + authTag.toString('hex');

      const result: EncryptedKey = {
        keyId,
        encryptedData,
        iv: iv.toString('hex'),
        salt: salt.toString('hex'),
        algorithm: this.algorithm,
        createdAt: new Date(),
      };

      // Audit logging (without leaking the private key)
      await this.auditService.appendEntry({
        actor: 'key-vault',
        action: 'private_key_encrypted',
        resourceType: 'WalletKey',
        resourceId: keyId,
        payload: {
          algorithm: this.algorithm,
          keyLength: this.keyLength,
          timestamp: new Date().toISOString(),
        },
      });

      // Persist the ciphertext through the store (write-through). When no store
      // is bound (dev/test fallback) the encrypted blob is not retained — callers
      // that need round-trip in that mode must use storeEncryptedKey with a bound store.
      if (this.store) {
        await this.store.saveEncryptedKey(keyId, result);
      }

      // Update metrics
      this.encryptLatency = Date.now() - startTime;
      this.encryptCount++;

      this.logger.debug(`Encrypted private key for keyId: ${keyId} (${this.encryptLatency}ms)`);

      return result;
    } catch (error) {
      this.logger.error(`Failed to encrypt private key for keyId: ${keyId}`, error);
      throw new Error(`Failed to encrypt private key: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Decrypt a private key
   * @param encryptedKey - The encrypted key data
   * @returns The decrypted private key (hex string without 0x prefix)
   */
  async decryptPrivateKey(encryptedKey: EncryptedKey): Promise<string> {
    const startTime = Date.now();

    try {
      // Validate algorithm
      if (encryptedKey.algorithm !== this.algorithm) {
        throw new Error(`Unsupported algorithm: ${encryptedKey.algorithm}`);
      }

      // Derive key from master key + salt
      const salt = Buffer.from(encryptedKey.salt, 'hex');
      const derivedKey = scryptSync(this.encryptionKey, salt, this.keyLength);

      const iv = Buffer.from(encryptedKey.iv, 'hex');
      const encryptedData = encryptedKey.encryptedData;

      // Split encrypted data and auth tag
      const authTagHex = encryptedData.slice(-32); // GCM auth tag is 16 bytes = 32 hex chars
      const encrypted = encryptedData.slice(0, -32);

      // Decrypt
      const decipher = createDecipheriv(this.algorithm, derivedKey, iv);
      decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));

      let decrypted = decipher.update(encrypted, 'hex', 'utf8');
      decrypted += decipher.final('utf8');

      // Validate decrypted key format
      if (!this.isValidPrivateKey(decrypted)) {
        throw new Error('Decrypted data is not a valid private key');
      }

      // Audit logging (without leaking the private key)
      await this.auditService.appendEntry({
        actor: 'key-vault',
        action: 'private_key_decrypted',
        resourceType: 'WalletKey',
        resourceId: encryptedKey.keyId,
        payload: {
          algorithm: encryptedKey.algorithm,
          timestamp: new Date().toISOString(),
        },
      });

      // Update metrics
      this.decryptLatency = Date.now() - startTime;
      this.decryptCount++;

      this.logger.debug(`Decrypted private key for keyId: ${encryptedKey.keyId} (${this.decryptLatency}ms)`);

      return decrypted;
    } catch (error) {
      this.logger.error(`Failed to decrypt private key for keyId: ${encryptedKey.keyId}`, error);
      throw new Error(`Failed to decrypt private key: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Register a wallet key metadata
   * @param keyId - Unique identifier for this key
   * @param address - Wallet address
   * @param chainId - Chain ID
   */
  async registerWalletKey(keyId: string, address: string, chainId: number): Promise<void> {
    if (this.metaCache.has(keyId)) {
      throw new Error(`Key ${keyId} already registered`);
    }

    const record: WalletKeyRecord = {
      keyId,
      address: address.toLowerCase(),
      chainId,
      isActive: true,
      createdAt: new Date(),
    };

    // Write-through to the persistent store and the in-memory cache together.
    if (this.store) {
      await this.store.saveKeyMeta(record);
    }
    this.metaCache.set(keyId, record);

    // Audit logging
    await this.auditService.appendEntry({
      actor: 'key-vault',
      action: 'wallet_key_registered',
      resourceType: 'WalletKey',
      resourceId: keyId,
      payload: {
        address: address,
        chainId: chainId,
        timestamp: new Date().toISOString(),
      },
    });

    this.logger.log(`Registered wallet key: ${keyId} for address ${address} on chain ${chainId}`);
  }

  /**
   * Get wallet key metadata
   * @param keyId - Key identifier
   */
  getWalletKey(keyId: string): WalletKey | undefined {
    const record = this.metaCache.get(keyId);
    return record ? this.recordToWalletKey(record) : undefined;
  }

  /**
   * Get all wallet keys
   */
  getAllWalletKeys(): WalletKey[] {
    return Array.from(this.metaCache.values()).map((r) => this.recordToWalletKey(r));
  }

  /**
   * Get wallet keys by chain
   * @param chainId - Chain ID
   */
  getWalletKeysByChain(chainId: number): WalletKey[] {
    return Array.from(this.metaCache.values())
      .filter((k) => k.chainId === chainId && k.isActive)
      .map((r) => this.recordToWalletKey(r));
  }

  /**
   * Deactivate a wallet key
   * @param keyId - Key identifier
   */
  async deactivateWalletKey(keyId: string): Promise<void> {
    const record = this.metaCache.get(keyId);
    if (!record) {
      throw new Error(`Key ${keyId} not found`);
    }

    record.isActive = false;
    if (this.store) {
      await this.store.setActive(keyId, false);
    }

    // Audit logging
    await this.auditService.appendEntry({
      actor: 'key-vault',
      action: 'wallet_key_deactivated',
      resourceType: 'WalletKey',
      resourceId: keyId,
      payload: {
        address: record.address,
        chainId: record.chainId,
        timestamp: new Date().toISOString(),
      },
    });

    this.logger.log(`Deactivated wallet key: ${keyId}`);
  }

  /**
   * Rotate a wallet key (deactivate old, register new)
   * @param oldKeyId - Old key identifier
   * @param newKeyId - New key identifier
   * @param newAddress - New wallet address
   * @param chainId - Chain ID
   */
  async rotateWalletKey(
    oldKeyId: string,
    newKeyId: string,
    newAddress: string,
    chainId: number
  ): Promise<void> {
    const oldKey = this.metaCache.get(oldKeyId);
    if (!oldKey) {
      throw new Error(`Old key ${oldKeyId} not found`);
    }

    // Deactivate old key
    await this.deactivateWalletKey(oldKeyId);

    // Register new key
    await this.registerWalletKey(newKeyId, newAddress, chainId);

    // Audit logging
    await this.auditService.appendEntry({
      actor: 'key-vault',
      action: 'wallet_key_rotated',
      resourceType: 'WalletKey',
      resourceId: newKeyId,
      payload: {
        oldKeyId: oldKeyId,
        oldAddress: oldKey.address,
        newAddress: newAddress,
        chainId: chainId,
        timestamp: new Date().toISOString(),
      },
    });

    this.logger.log(`Rotated wallet key: ${oldKeyId} -> ${newKeyId}`);
  }

  /**
   * Update last used timestamp for a key
   * @param keyId - Key identifier
   *
   * Stays synchronous (called fire-and-forget from wallet-manager). Updates the
   * metadata cache immediately and best-effort persists to the store; persistence
   * failures are logged but do not surface to callers.
   */
  updateKeyLastUsed(keyId: string): void {
    const record = this.metaCache.get(keyId);
    if (!record) {
      return;
    }
    record.lastUsedAt = new Date();
    if (this.store) {
      this.store.updateLastUsed(keyId, record.lastUsedAt).catch((error) => {
        this.logger.warn(`Failed to persist lastUsedAt for keyId ${keyId}: ${error}`);
      });
    }
  }

  /**
   * Store an encrypted key (e.g. loaded from database on startup)
   * @param keyId - Key identifier
   * @param encryptedKey - The encrypted key data to store
   *
   * D4-B-4-KEYS: persists the ciphertext through the store. The plaintext is
   * never retained in memory after this call.
   */
  async storeEncryptedKey(keyId: string, encryptedKey: EncryptedKey): Promise<void> {
    if (this.store) {
      await this.store.saveEncryptedKey(keyId, encryptedKey);
    }
    this.logger.debug(`Stored encrypted key for keyId: ${keyId}`);
  }

  /**
   * Retrieve an encrypted key by keyId
   * @param keyId - Key identifier
   * @returns The encrypted key data, or undefined if not found
   *
   * D4-B-4-KEYS: reads the ciphertext ON DEMAND from the store (no in-memory
   * cache of the blob). The returned value still needs {@link decryptPrivateKey}
   * to produce the signing key — the plaintext exists only inside that call.
   */
  async retrieveEncryptedKey(keyId: string): Promise<EncryptedKey | undefined> {
    if (this.store) {
      return (await this.store.getEncryptedKey(keyId)) ?? undefined;
    }
    return undefined;
  }

  /**
   * Validate private key format
   * @param privateKey - Private key to validate
   */
  private isValidPrivateKey(privateKey: string): boolean {
    // Remove 0x prefix if present
    const cleanKey = privateKey.startsWith('0x') ? privateKey.slice(2) : privateKey;

    // Must be 64 hex characters (32 bytes)
    return /^[0-9a-fA-F]{64}$/.test(cleanKey);
  }

  /**
   * Map a metadata record to the public WalletKey shape.
   */
  private recordToWalletKey(record: WalletKeyRecord): WalletKey {
    return {
      keyId: record.keyId,
      address: record.address,
      chainId: record.chainId,
      isActive: record.isActive,
      createdAt: record.createdAt,
      lastUsedAt: record.lastUsedAt,
    };
  }

  /**
   * Get performance metrics
   */
  getMetrics() {
    return {
      encryptLatency: this.encryptLatency,
      decryptLatency: this.decryptLatency,
      encryptCount: this.encryptCount,
      decryptCount: this.decryptCount,
      averageEncryptLatency: this.encryptCount > 0 ? this.encryptLatency / this.encryptCount : 0,
      averageDecryptLatency: this.decryptCount > 0 ? this.decryptLatency / this.decryptCount : 0,
    };
  }
}
