import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Wallet Key Entity (D4-B-4-KEYS, L4).
 *
 * Persists AES-256-GCM encrypted private keys so they survive process restarts,
 * replacing the in-memory `encryptedKeys` Map in KeyVaultService.
 *
 * The row stores ONLY the ciphertext blob (ciphertext + auth tag), iv, salt and
 * algorithm — never the plaintext private key. The master encryption key
 * (PRIVATE_KEY_ENCRYPTION_KEY) lives in the environment / Vault.
 *
 * Single-writer: execution-orchestrator (KeyVaultService via WalletKeyStore adapter).
 */
@Entity({ name: 'wallet_keys' })
@Index('idx_wallet_keys_chain_id', ['chainId'])
@Index('idx_wallet_keys_is_active', ['isActive'])
export class WalletKeyEntity {
  @PrimaryColumn({ name: 'key_id', type: 'text' })
  keyId!: string;

  @Column({ name: 'address', type: 'varchar', length: 42 })
  address!: string;

  @Column({ name: 'chain_id', type: 'integer' })
  chainId!: number;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive!: boolean;

  /** AES-256-GCM ciphertext (hex) + 16-byte auth tag (hex). NEVER plaintext. */
  @Column({ name: 'encrypted_data', type: 'text' })
  encryptedData!: string;

  @Column({ name: 'iv', type: 'text' })
  iv!: string;

  @Column({ name: 'salt', type: 'text' })
  salt!: string;

  @Column({ name: 'algorithm', type: 'varchar', length: 32, default: 'aes-256-gcm' })
  algorithm!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp with time zone' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp with time zone' })
  updatedAt!: Date;

  @Column({ name: 'last_used_at', type: 'timestamp with time zone', nullable: true })
  lastUsedAt!: Date | null;
}
