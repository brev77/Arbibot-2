import { Test, TestingModule } from '@nestjs/testing';
import { KeyVaultService, type EncryptedKey } from './key-vault.service';
import {
  WALLET_KEY_STORE,
  type WalletKeyRecord,
  type WalletKeyStore,
} from './wallet-key-store';
import { AuditClientService } from '../audit-client.service';

/**
 * Minimal in-memory WalletKeyStore used to exercise the DB-backed code path
 * (D4-B-4-KEYS) without a real Postgres. Simulates the production adapter.
 */
function createInMemoryStore(): WalletKeyStore & {
  meta: Map<string, WalletKeyRecord>;
  blobs: Map<string, EncryptedKey>;
} {
  const meta = new Map<string, WalletKeyRecord>();
  const blobs = new Map<string, EncryptedKey>();
  return {
    meta,
    blobs,
    saveKeyMeta: (record: WalletKeyRecord): Promise<void> => {
      meta.set(record.keyId, { ...record });
      return Promise.resolve();
    },
    getKeyMeta: (keyId: string): Promise<WalletKeyRecord | null> =>
      Promise.resolve(meta.get(keyId) ?? null),
    getAllKeyMeta: (): Promise<WalletKeyRecord[]> =>
      Promise.resolve(Array.from(meta.values())),
    getKeysByChain: (chainId: number): Promise<WalletKeyRecord[]> =>
      Promise.resolve(Array.from(meta.values()).filter((r) => r.chainId === chainId)),
    saveEncryptedKey: (keyId: string, encryptedKey: EncryptedKey): Promise<void> => {
      blobs.set(keyId, { ...encryptedKey });
      return Promise.resolve();
    },
    getEncryptedKey: (keyId: string): Promise<EncryptedKey | null> =>
      Promise.resolve(blobs.get(keyId) ?? null),
    setActive: (keyId: string, isActive: boolean): Promise<void> => {
      const r = meta.get(keyId);
      if (r) meta.set(keyId, { ...r, isActive });
      return Promise.resolve();
    },
    updateLastUsed: (keyId: string, lastUsedAt: Date): Promise<void> => {
      const r = meta.get(keyId);
      if (r) meta.set(keyId, { ...r, lastUsedAt });
      return Promise.resolve();
    },
  };
}

describe('KeyVaultService', () => {
  let service: KeyVaultService;
  const testEncryptionKey = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

  beforeEach(async () => {
    process.env.PRIVATE_KEY_ENCRYPTION_KEY = testEncryptionKey;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        KeyVaultService,
        {
          provide: AuditClientService,
          useValue: {
            appendEntry: jest.fn().mockResolvedValue(undefined),
          },
        },
      ],
    }).compile();

    service = module.get<KeyVaultService>(KeyVaultService);
  });

  afterEach(() => {
    delete process.env.PRIVATE_KEY_ENCRYPTION_KEY;
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('registerWalletKey (in-memory fallback, no store)', () => {
    it('should register a new wallet key', async () => {
      await service.registerWalletKey('test-key-1', '0x1234567890123456789012345678901234567890', 42161);

      const retrievedKey = service.getWalletKey('test-key-1');
      expect(retrievedKey).toBeDefined();
      expect(retrievedKey!.keyId).toBe('test-key-1');
      expect(retrievedKey!.chainId).toBe(42161);
      expect(retrievedKey!.address).toBe('0x1234567890123456789012345678901234567890');
      expect(retrievedKey!.isActive).toBe(true);
    });

    it('should throw error if key already exists', async () => {
      await service.registerWalletKey('test-key-1', '0x1234567890123456789012345678901234567890', 42161);

      await expect(
        service.registerWalletKey('test-key-1', '0x1234567890123456789012345678901234567890', 42161),
      ).rejects.toThrow('Key test-key-1 already registered');
    });
  });

  describe('encryptPrivateKey', () => {
    it('should encrypt a private key and return ciphertext (not the key)', async () => {
      const privateKey = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

      const encrypted = await service.encryptPrivateKey(privateKey, 'test-key-1');

      expect(encrypted).toBeDefined();
      expect(encrypted.keyId).toBe('test-key-1');
      expect(encrypted.encryptedData).toBeDefined();
      expect(encrypted.iv).toBeDefined();
      expect(encrypted.salt).toBeDefined();
      expect(encrypted.algorithm).toBe('aes-256-gcm');
      expect(encrypted.encryptedData).not.toBe(privateKey);
    });

    it('should encrypt same key differently each time (due to random IV + salt)', async () => {
      const privateKey = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

      const encrypted1 = await service.encryptPrivateKey(privateKey, 'key-a');
      const encrypted2 = await service.encryptPrivateKey(privateKey, 'key-b');

      expect(encrypted1.encryptedData).not.toBe(encrypted2.encryptedData);
      expect(encrypted1.iv).not.toBe(encrypted2.iv);
    });

    it('should reject invalid private key format', async () => {
      await expect(
        service.encryptPrivateKey('invalid-key', 'test-key-1'),
      ).rejects.toThrow('Invalid private key format');
    });
  });

  describe('decryptPrivateKey', () => {
    it('should decrypt an encrypted private key', async () => {
      const privateKey = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

      const encrypted = await service.encryptPrivateKey(privateKey, 'test-key-1');
      const decrypted = await service.decryptPrivateKey(encrypted);

      expect(decrypted).toBe(privateKey);
    });

    it('should throw error on malformed encrypted data', async () => {
      const encrypted: EncryptedKey = {
        keyId: 'test-key',
        encryptedData: 'invalid',
        iv: 'a'.repeat(32),
        salt: 'b'.repeat(64),
        algorithm: 'aes-256-gcm',
        createdAt: new Date(),
      };

      await expect(
        service.decryptPrivateKey(encrypted),
      ).rejects.toThrow();
    });

    it('should throw error on unsupported algorithm', async () => {
      const encrypted: EncryptedKey = {
        keyId: 'test-key',
        encryptedData: 'some-data',
        iv: 'a'.repeat(32),
        salt: 'b'.repeat(64),
        algorithm: 'unknown-algo',
        createdAt: new Date(),
      };

      await expect(
        service.decryptPrivateKey(encrypted),
      ).rejects.toThrow('Unsupported algorithm: unknown-algo');
    });
  });

  describe('getWalletKeysByChain (in-memory fallback)', () => {
    it('should return keys for specific chain', async () => {
      await service.registerWalletKey('test-key-1', '0x1111111111111111111111111111111111111111', 42161);
      await service.registerWalletKey('test-key-2', '0x2222222222222222222222222222222222222222', 8453);

      const arbitrumKeys = service.getWalletKeysByChain(42161);
      const baseKeys = service.getWalletKeysByChain(8453);

      expect(arbitrumKeys).toHaveLength(1);
      expect(arbitrumKeys[0]!.keyId).toBe('test-key-1');
      expect(baseKeys).toHaveLength(1);
      expect(baseKeys[0]!.keyId).toBe('test-key-2');
    });

    it('should return empty array for non-existent chain', () => {
      const keys = service.getWalletKeysByChain(1);
      expect(keys).toEqual([]);
    });

    it('should exclude inactive keys', async () => {
      await service.registerWalletKey('test-key-1', '0x1111111111111111111111111111111111111111', 42161);
      await service.deactivateWalletKey('test-key-1');

      const keys = service.getWalletKeysByChain(42161);
      expect(keys).toHaveLength(0);
    });
  });

  describe('updateKeyLastUsed', () => {
    it('should update last used timestamp', async () => {
      await service.registerWalletKey('test-key-1', '0x1111111111111111111111111111111111111111', 42161);

      await new Promise(resolve => setTimeout(resolve, 10));

      service.updateKeyLastUsed('test-key-1');

      const updatedKey = service.getWalletKey('test-key-1');
      expect(updatedKey?.lastUsedAt).toBeDefined();
      expect(updatedKey?.lastUsedAt).toBeInstanceOf(Date);
    });

    it('should not throw for non-existent key', () => {
      // updateKeyLastUsed silently ignores missing keys
      expect(() => service.updateKeyLastUsed('non-existent-key')).not.toThrow();
    });
  });

  describe('deactivateWalletKey (in-memory fallback)', () => {
    it('should deactivate an active key', async () => {
      await service.registerWalletKey('test-key-1', '0x1111111111111111111111111111111111111111', 42161);
      await service.deactivateWalletKey('test-key-1');

      const key = service.getWalletKey('test-key-1');
      expect(key?.isActive).toBe(false);
    });

    it('should throw for non-existent key', async () => {
      await expect(service.deactivateWalletKey('non-existent')).rejects.toThrow('Key non-existent not found');
    });
  });

  describe('rotateWalletKey (in-memory fallback)', () => {
    it('should deactivate old key and register new one', async () => {
      await service.registerWalletKey('old-key', '0x1111111111111111111111111111111111111111', 42161);
      await service.rotateWalletKey('old-key', 'new-key', '0x2222222222222222222222222222222222222222', 42161);

      const oldKey = service.getWalletKey('old-key');
      const newKey = service.getWalletKey('new-key');

      expect(oldKey?.isActive).toBe(false);
      expect(newKey).toBeDefined();
      expect(newKey?.isActive).toBe(true);
      expect(newKey?.address).toBe('0x2222222222222222222222222222222222222222');
    });
  });

  describe('retrieveEncryptedKey without store (in-memory fallback)', () => {
    it('should return undefined — ciphertext is not retained without a store', async () => {
      const privateKey = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
      await service.encryptPrivateKey(privateKey, 'test-key-1');

      // D4-B-4-KEYS: without a bound store the ciphertext is NOT held in memory.
      const retrieved = await service.retrieveEncryptedKey('test-key-1');
      expect(retrieved).toBeUndefined();
    });

    it('should return undefined for non-existent key', async () => {
      expect(await service.retrieveEncryptedKey('non-existent')).toBeUndefined();
    });
  });

  describe('getMetrics', () => {
    it('should return performance metrics', async () => {
      const privateKey = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
      const encrypted = await service.encryptPrivateKey(privateKey, 'test-key-1');
      await service.decryptPrivateKey(encrypted);

      const metrics = service.getMetrics();
      expect(metrics.encryptCount).toBe(1);
      expect(metrics.decryptCount).toBe(1);
      expect(metrics.encryptLatency).toBeGreaterThanOrEqual(0);
      expect(metrics.decryptLatency).toBeGreaterThanOrEqual(0);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // D4-B-4-KEYS: DB-backed path (WalletKeyStore bound). These tests verify the
  // persistence contract — encrypted keys survive a "restart" (new service
  // instance sharing the same store) and are decrypted on demand.
  // ─────────────────────────────────────────────────────────────────────────
  describe('DB-backed persistence (WalletKeyStore bound)', () => {
    let store: ReturnType<typeof createInMemoryStore>;
    let dbService: KeyVaultService;

    beforeEach(async () => {
      process.env.PRIVATE_KEY_ENCRYPTION_KEY = testEncryptionKey;
      store = createInMemoryStore();

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          KeyVaultService,
          {
            provide: AuditClientService,
            useValue: { appendEntry: jest.fn().mockResolvedValue(undefined) },
          },
          { provide: WALLET_KEY_STORE, useValue: store },
        ],
      }).compile();

      dbService = module.get<KeyVaultService>(KeyVaultService);
      await dbService.onModuleInit();
    });

    it('should persist encrypted key to the store and retrieve it on demand', async () => {
      const privateKey = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
      const encrypted = await dbService.encryptPrivateKey(privateKey, 'db-key-1');

      // The ciphertext is now in the store, not in a process-lifetime Map.
      expect(store.blobs.get('db-key-1')).toEqual(encrypted);

      // On-demand retrieval reads it back from the store.
      const retrieved = await dbService.retrieveEncryptedKey('db-key-1');
      expect(retrieved).toEqual(encrypted);

      // And it round-trips through decryptPrivateKey.
      const decrypted = await dbService.decryptPrivateKey(retrieved!);
      expect(decrypted).toBe(privateKey);
    });

    it('should survive a process restart — decrypt on demand from a fresh instance', async () => {
      // Instance A: register + encrypt + persist.
      const privateKey = 'fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210';
      await dbService.registerWalletKey('restart-key', '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 42161);
      const encrypted = await dbService.encryptPrivateKey(privateKey, 'restart-key');
      await dbService.storeEncryptedKey('restart-key', encrypted);

      // Instance B: new KeyVaultService bound to the SAME store (simulates restart).
      const moduleB: TestingModule = await Test.createTestingModule({
        providers: [
          KeyVaultService,
          {
            provide: AuditClientService,
            useValue: { appendEntry: jest.fn().mockResolvedValue(undefined) },
          },
          { provide: WALLET_KEY_STORE, useValue: store },
        ],
      }).compile();
      const restartedService = moduleB.get<KeyVaultService>(KeyVaultService);
      await restartedService.onModuleInit();

      // Metadata cache was hydrated from the store on init.
      const keyMeta = restartedService.getWalletKey('restart-key');
      expect(keyMeta).toBeDefined();
      expect(keyMeta!.address).toBe('0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');

      // Encrypted blob is fetched on demand and decrypts correctly.
      const retrieved = await restartedService.retrieveEncryptedKey('restart-key');
      expect(retrieved).toBeDefined();
      const decrypted = await restartedService.decryptPrivateKey(retrieved!);
      expect(decrypted).toBe(privateKey);
    });

    it('registerWalletKey should persist metadata through the store', async () => {
      await dbService.registerWalletKey('meta-key', '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', 8453);

      // Store received the metadata.
      const stored = store.meta.get('meta-key');
      expect(stored).toBeDefined();
      expect(stored!.chainId).toBe(8453);
      expect(stored!.isActive).toBe(true);
    });

    it('deactivateWalletKey should persist the active flag through the store', async () => {
      await dbService.registerWalletKey('deact-key', '0xcccccccccccccccccccccccccccccccccccccccc', 42161);
      await dbService.deactivateWalletKey('deact-key');

      expect(store.meta.get('deact-key')!.isActive).toBe(false);
      expect(dbService.getWalletKey('deact-key')!.isActive).toBe(false);
    });

    it('updateKeyLastUsed should best-effort persist through the store', async () => {
      await dbService.registerWalletKey('used-key', '0xdddddddddddddddddddddddddddddddddddddddd', 42161);
      dbService.updateKeyLastUsed('used-key');

      // fire-and-forget persistence — give the microtask a tick.
      await new Promise((resolve) => setImmediate(resolve));

      expect(store.meta.get('used-key')!.lastUsedAt).toBeDefined();
    });

    it('onModuleInit should hydrate the metadata cache from the store', async () => {
      // Seed the store directly (simulating pre-existing rows).
      await store.saveKeyMeta({
        keyId: 'seeded-key',
        address: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
        chainId: 42161,
        isActive: true,
        createdAt: new Date(),
      });

      // Fresh service hydrates from the store.
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          KeyVaultService,
          {
            provide: AuditClientService,
            useValue: { appendEntry: jest.fn().mockResolvedValue(undefined) },
          },
          { provide: WALLET_KEY_STORE, useValue: store },
        ],
      }).compile();
      const fresh = module.get<KeyVaultService>(KeyVaultService);
      await fresh.onModuleInit();

      expect(fresh.getWalletKey('seeded-key')).toBeDefined();
      expect(fresh.getWalletKeysByChain(42161).some((k) => k.keyId === 'seeded-key')).toBe(true);
    });
  });
});
