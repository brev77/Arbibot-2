import { Test, TestingModule } from '@nestjs/testing';
import { KeyVaultService, EncryptedKey } from './key-vault.service';
import { AuditClientService } from '../audit-client.service';

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

    // Clear in-memory stores
    service['keys'] = new Map();
    service['encryptedKeys'] = new Map();
  });

  afterEach(() => {
    delete process.env.PRIVATE_KEY_ENCRYPTION_KEY;
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('registerWalletKey', () => {
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
    it('should encrypt a private key and store it', async () => {
      const privateKey = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

      const encrypted = await service.encryptPrivateKey(privateKey, 'test-key-1');

      expect(encrypted).toBeDefined();
      expect(encrypted.keyId).toBe('test-key-1');
      expect(encrypted.encryptedData).toBeDefined();
      expect(encrypted.iv).toBeDefined();
      expect(encrypted.salt).toBeDefined();
      expect(encrypted.algorithm).toBe('aes-256-gcm');
      expect(encrypted.encryptedData).not.toBe(privateKey);

      // Should be stored in encryptedKeys map
      expect(service.retrieveEncryptedKey('test-key-1')).toEqual(encrypted);
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

  describe('getWalletKeysByChain', () => {
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

      // Wait a bit to ensure time difference
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

  describe('storeEncryptedKey / retrieveEncryptedKey', () => {
    it('should store and retrieve an encrypted key', async () => {
      const privateKey = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
      const encrypted = await service.encryptPrivateKey(privateKey, 'source-key');

      // Store under a different keyId (simulating loading from DB)
      service.storeEncryptedKey('target-key', encrypted);

      const retrieved = service.retrieveEncryptedKey('target-key');
      expect(retrieved).toEqual(encrypted);
    });

    it('should return undefined for non-existent key', () => {
      expect(service.retrieveEncryptedKey('non-existent')).toBeUndefined();
    });
  });

  describe('deactivateWalletKey', () => {
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

  describe('rotateWalletKey', () => {
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
});