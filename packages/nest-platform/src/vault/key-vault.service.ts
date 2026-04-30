import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';
import { AuditClientService } from '../audit-client.service';

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
 * Step: DEX-1-0-VAULT
 * 
 * Manages encryption/decryption of private keys with audit logging
 * Keys are encrypted at rest and only decrypted during signing
 */
@Injectable()
export class KeyVaultService implements OnModuleInit {
  private readonly logger = new Logger(KeyVaultService.name);
  private readonly encryptionKey: Buffer;
  private readonly algorithm = 'aes-256-gcm';
  private readonly keyLength = 32; // 256 bits
  private readonly ivLength = 16; // 128 bits
  private readonly saltLength = 32; // 256 bits

  // In-memory key registry (in production, this would be in encrypted database)
  private keys = new Map<string, WalletKey>();

  // In-memory encrypted key storage (in production, this would be in encrypted database)
  private encryptedKeys = new Map<string, EncryptedKey>();

  // Performance metrics
  private encryptLatency = 0;
  private decryptLatency = 0;
  private encryptCount = 0;
  private decryptCount = 0;

  constructor(private readonly auditService: AuditClientService) {
    const encryptionKeyHex = process.env.PRIVATE_KEY_ENCRYPTION_KEY;
    if (!encryptionKeyHex) {
      throw new Error('PRIVATE_KEY_ENCRYPTION_KEY environment variable is required');
    }

    // Derive encryption key from environment variable
    const salt = 'arbibot-vault-salt-v1';
    this.encryptionKey = scryptSync(encryptionKeyHex, salt, this.keyLength);
    this.logger.log('Key Vault Service initialized');
  }

  onModuleInit() {
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

      // Store encrypted key in memory
      this.encryptedKeys.set(keyId, result);

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
    if (this.keys.has(keyId)) {
      throw new Error(`Key ${keyId} already registered`);
    }

    const walletKey: WalletKey = {
      keyId,
      address: address.toLowerCase(),
      chainId,
      isActive: true,
      createdAt: new Date(),
    };

    this.keys.set(keyId, walletKey);

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
    return this.keys.get(keyId);
  }

  /**
   * Get all wallet keys
   */
  getAllWalletKeys(): WalletKey[] {
    return Array.from(this.keys.values());
  }

  /**
   * Get wallet keys by chain
   * @param chainId - Chain ID
   */
  getWalletKeysByChain(chainId: number): WalletKey[] {
    return Array.from(this.keys.values()).filter(k => k.chainId === chainId && k.isActive);
  }

  /**
   * Deactivate a wallet key
   * @param keyId - Key identifier
   */
  async deactivateWalletKey(keyId: string): Promise<void> {
    const key = this.keys.get(keyId);
    if (!key) {
      throw new Error(`Key ${keyId} not found`);
    }

    key.isActive = false;

    // Audit logging
    await this.auditService.appendEntry({
      actor: 'key-vault',
      action: 'wallet_key_deactivated',
      resourceType: 'WalletKey',
      resourceId: keyId,
      payload: {
        address: key.address,
        chainId: key.chainId,
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
    const oldKey = this.keys.get(oldKeyId);
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
   */
  updateKeyLastUsed(keyId: string): void {
    const key = this.keys.get(keyId);
    if (key) {
      key.lastUsedAt = new Date();
    }
  }

  /**
   * Store an encrypted key (e.g. loaded from database on startup)
   * @param keyId - Key identifier
   * @param encryptedKey - The encrypted key data to store
   */
  storeEncryptedKey(keyId: string, encryptedKey: EncryptedKey): void {
    this.encryptedKeys.set(keyId, encryptedKey);
    this.logger.debug(`Stored encrypted key for keyId: ${keyId}`);
  }

  /**
   * Retrieve an encrypted key by keyId
   * @param keyId - Key identifier
   * @returns The encrypted key data, or undefined if not found
   */
  retrieveEncryptedKey(keyId: string): EncryptedKey | undefined {
    return this.encryptedKeys.get(keyId);
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