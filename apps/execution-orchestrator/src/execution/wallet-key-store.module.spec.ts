import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { WalletKeyEntity } from '@arbibot/persistence';
import {
  AuditClientModule,
  AuditClientService,
  KeyVaultModule,
  KeyVaultService,
  WALLET_KEY_STORE,
} from '@arbibot/nest-platform';

import { WalletKeyStoreModule } from './wallet-key-store.module';
import { TypeOrmWalletKeyStore } from './wallet-key-store.typeorm';

/**
 * Module-level integration spec — proves the WALLET_KEY_STORE token is VISIBLE to
 * KeyVaultService (declared in the @Global KeyVaultModule) when bound via the
 * dedicated @Global WalletKeyStoreModule (PLAN12 #1).
 *
 * Regression guard for the Aéza live incident (2026-08-06): the binding lived in
 * a non-@Global ExecutionModule and KeyVaultService silently fell back to
 * in-memory persistence (no wallet keys loaded → selectWallet hang). The
 * server-side `attachStore()` late-bind masked the defect; this test asserts the
 * token is resolvable in the global scope without any late-bind workaround.
 *
 * Constructs a real Nest module graph (KeyVaultModule + WalletKeyStoreModule) and
 * asserts behaviorally that a key registered through KeyVaultService round-trips
 * through the bound TypeORM store (retrieveEncryptedKey returns the persisted
 * blob rather than undefined — the signature of the in-memory fallback bug).
 */
describe('WalletKeyStoreModule (DI visibility)', () => {
  const testEncryptionKey =
    '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

  let module: TestingModule;
  let keyVault: KeyVaultService;
  let repo: {
    save: jest.Mock;
    findOne: jest.Mock;
    find: jest.Mock;
    update: jest.Mock;
  };

  beforeEach(async () => {
    process.env.PRIVATE_KEY_ENCRYPTION_KEY = testEncryptionKey;

    // Minimal in-memory repository mock (mirrors wallet-key-store.typeorm.spec.ts).
    // Synchronous mock bodies wrapped in Promise.resolve (Repository methods are
    // async by contract) — `async () =>` would trip @typescript-eslint/require-await.
    const rows = new Map<string, WalletKeyEntity>();
    repo = {
      save: jest.fn((e: WalletKeyEntity) => {
        rows.set(e.keyId, e);
        return Promise.resolve(e);
      }),
      findOne: jest.fn(({ where }: { where: { keyId?: string } }) => {
        const id = where?.keyId;
        return Promise.resolve(id ? (rows.get(id) ?? null) : null);
      }),
      find: jest.fn(() => Promise.resolve(Array.from(rows.values()))),
      update: jest.fn(() => Promise.resolve(undefined)),
    };

    module = await Test.createTestingModule({
      // AuditClientModule is @Global in production (imported by AppModule) — include
      // it here so KeyVaultModule's scope can see AuditClientService, mirroring the
      // real app wiring. WalletKeyStoreModule is also @Global, making WALLET_KEY_STORE
      // visible to KeyVaultService.
      imports: [AuditClientModule, KeyVaultModule, WalletKeyStoreModule],
    })
      .overrideProvider(getRepositoryToken(WalletKeyEntity))
      .useValue(repo)
      .overrideProvider(AuditClientService)
      .useValue({ appendEntry: jest.fn().mockResolvedValue(undefined) })
      .compile();

    keyVault = module.get(KeyVaultService);
    await keyVault.onModuleInit();
  });

  afterEach(() => {
    delete process.env.PRIVATE_KEY_ENCRYPTION_KEY;
    delete process.env.VAULT_MASTER_KEY_SALT;
  });

  it('binds WALLET_KEY_STORE so KeyVaultService receives the TypeORM adapter', () => {
    // The token must resolve to a concrete adapter inside the global scope — this
    // is the exact visibility the old (ExecutionModule-local) binding lacked.
    const store = module.get(WALLET_KEY_STORE);
    expect(store).toBeInstanceOf(TypeOrmWalletKeyStore);
  });

  it('persists an encrypted key through the store and round-trips it', async () => {
    // A deterministic test private key (well-known hardhat key #0 — 64 hex chars).
    const privateKey =
      'ac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';

    await keyVault.registerWalletKey(
      'test-key-1',
      '0x1234567890123456789012345678901234567890',
      42161,
    );
    const encrypted = await keyVault.encryptPrivateKey(privateKey, 'test-key-1');

    // Round-trip: the store must hold the ciphertext (undefined = in-memory fallback bug).
    const retrieved = await keyVault.retrieveEncryptedKey('test-key-1');
    expect(retrieved).toBeDefined();
    expect(retrieved!.encryptedData).toBe(encrypted.encryptedData);

    // And the service must be able to decrypt it back to the original key.
    const decrypted = await keyVault.decryptPrivateKey(retrieved!);
    expect(decrypted).toBe(privateKey);
  });

  it('makes registered keys visible to sync readers (meta cache)', async () => {
    // registerWalletKey writes through the store AND updates the in-memory cache,
    // so sync readers (wallet selection) see the key immediately.
    await keyVault.registerWalletKey(
      'sync-key-1',
      '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
      8453,
    );
    const key = keyVault.getWalletKey('sync-key-1');
    expect(key).toBeDefined();
    expect(key!.chainId).toBe(8453);
    // And chain-filtered lookups (the path selectWallet uses) must find it.
    const byChain = keyVault.getWalletKeysByChain(8453);
    expect(byChain).toHaveLength(1);
    expect(byChain[0]!.keyId).toBe('sync-key-1');
  });
});
