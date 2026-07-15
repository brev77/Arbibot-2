import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { WalletKeyEntity } from '@arbibot/persistence';
import {
  EncryptedKey,
  type WalletKeyRecord,
  type WalletKeyStore,
} from '@arbibot/nest-platform';

/**
 * TypeORM adapter for the {@link WalletKeyStore} port (D4-B-4-KEYS).
 *
 * Persists AES-256-GCM encrypted wallet keys to the `wallet_keys` table so they
 * survive process restarts. Single-writer: execution-orchestrator. Plaintext
 * private keys never cross this boundary — only the ciphertext blob.
 */
@Injectable()
export class TypeOrmWalletKeyStore implements WalletKeyStore {
  private readonly logger = new Logger(TypeOrmWalletKeyStore.name);

  constructor(
    @InjectRepository(WalletKeyEntity)
    private readonly repo: Repository<WalletKeyEntity>,
  ) {}

  async saveKeyMeta(record: WalletKeyRecord): Promise<void> {
    await this.repo.save({
      keyId: record.keyId,
      address: record.address,
      chainId: record.chainId,
      isActive: record.isActive,
      // Encrypted payload columns are nullable on first metadata insert; they are
      // populated later via saveEncryptedKey once a private key is encrypted.
      encryptedData: '',
      iv: '',
      salt: '',
      algorithm: 'aes-256-gcm',
      lastUsedAt: record.lastUsedAt ?? null,
    });
  }

  async getKeyMeta(keyId: string): Promise<WalletKeyRecord | null> {
    const row = await this.repo.findOne({ where: { keyId } });
    return row ? this.toRecord(row) : null;
  }

  async getAllKeyMeta(): Promise<WalletKeyRecord[]> {
    const rows = await this.repo.find();
    return rows.map((r) => this.toRecord(r));
  }

  async getKeysByChain(chainId: number): Promise<WalletKeyRecord[]> {
    const rows = await this.repo.find({ where: { chainId } });
    return rows.map((r) => this.toRecord(r));
  }

  async saveEncryptedKey(keyId: string, encryptedKey: EncryptedKey): Promise<void> {
    // Upsert: insert the row if absent, otherwise update only the encrypted
    // payload columns (preserve address/chainId/isActive when already set).
    const existing = await this.repo.findOne({ where: { keyId } });
    if (existing) {
      existing.encryptedData = encryptedKey.encryptedData;
      existing.iv = encryptedKey.iv;
      existing.salt = encryptedKey.salt;
      existing.algorithm = encryptedKey.algorithm;
      await this.repo.save(existing);
      return;
    }
    await this.repo.save({
      keyId,
      address: '',
      chainId: 0,
      isActive: true,
      encryptedData: encryptedKey.encryptedData,
      iv: encryptedKey.iv,
      salt: encryptedKey.salt,
      algorithm: encryptedKey.algorithm,
    });
  }

  async getEncryptedKey(keyId: string): Promise<EncryptedKey | null> {
    const row = await this.repo.findOne({ where: { keyId } });
    if (!row || !row.encryptedData) {
      return null;
    }
    return {
      keyId: row.keyId,
      encryptedData: row.encryptedData,
      iv: row.iv,
      salt: row.salt,
      algorithm: row.algorithm,
      createdAt: row.createdAt,
    };
  }

  async setActive(keyId: string, isActive: boolean): Promise<void> {
    const row = await this.repo.findOne({ where: { keyId } });
    if (!row) {
      this.logger.warn(`setActive: key ${keyId} not found`);
      return;
    }
    row.isActive = isActive;
    await this.repo.save(row);
  }

  async updateLastUsed(keyId: string, lastUsedAt: Date): Promise<void> {
    await this.repo.update({ keyId }, { lastUsedAt });
  }

  private toRecord(row: WalletKeyEntity): WalletKeyRecord {
    return {
      keyId: row.keyId,
      address: row.address,
      chainId: row.chainId,
      isActive: row.isActive,
      createdAt: row.createdAt,
      lastUsedAt: row.lastUsedAt ?? undefined,
    };
  }
}
