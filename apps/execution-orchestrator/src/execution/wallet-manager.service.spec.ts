import { Test, TestingModule } from '@nestjs/testing';
import { getArbibotMetricsRegistry } from '@arbibot/nest-platform';
import { WalletManagerService } from './wallet-manager.service';
import { KeyVaultService } from '@arbibot/nest-platform';
import { getRepositoryToken } from '@nestjs/typeorm';
import { WalletState } from '@arbibot/persistence';
import { Provider } from 'ethers';
import { Address, ChainId } from '@arbibot/contracts-eth';

// Mock ethers
jest.mock('ethers', () => ({
  Wallet: jest.fn().mockImplementation((privateKey: string) => ({
    address: '0x' + privateKey.slice(-40),
    getNonce: jest.fn().mockResolvedValue(0),
  })),
  Contract: jest.fn().mockImplementation(() => ({
    balanceOf: jest.fn().mockResolvedValue(BigInt('1000000000000000000')),
  })),
  formatUnits: jest.fn().mockReturnValue('1.0'),
  parseUnits: jest.fn().mockReturnValue(BigInt('1000000000000000000')),
}));

describe('WalletManagerService', () => {
  let service: WalletManagerService;
  let keyVaultService: jest.Mocked<KeyVaultService>;
  let walletStateRepo: { find: jest.Mock; findOne: jest.Mock; create: jest.Mock; save: jest.Mock };

  const mockWalletKeys = [
    {
      keyId: 'key-1',
      address: '0x1234567890abcdef1234567890abcdef12345678',
      chainId: 42161,
      isActive: true,
      lastUsedAt: new Date('2026-01-01'),
    },
    {
      keyId: 'key-2',
      address: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
      chainId: 42161,
      isActive: true,
      lastUsedAt: new Date('2026-01-02'),
    },
  ];

  const mockEncryptedKey = {
    keyId: 'key-1',
    encryptedData: 'abc123',
    iv: 'def456',
    salt: 'aabbccdd',
    algorithm: 'aes-256-gcm',
    createdAt: new Date(),
  };

  beforeEach(async () => {
    getArbibotMetricsRegistry().clear();

    const mockKeyVaultService = {
      getWalletKeysByChain: jest.fn().mockReturnValue(mockWalletKeys),
      getWalletKey: jest.fn().mockReturnValue(mockWalletKeys[0]),
      retrieveEncryptedKey: jest.fn().mockResolvedValue(mockEncryptedKey),
      decryptPrivateKey: jest.fn().mockResolvedValue('0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef'),
      updateKeyLastUsed: jest.fn().mockResolvedValue(undefined),
    };

    walletStateRepo = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockReturnValue({}),
      save: jest.fn().mockResolvedValue({}),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WalletManagerService,
        {
          provide: KeyVaultService,
          useValue: mockKeyVaultService,
        },
        {
          provide: getRepositoryToken(WalletState),
          useValue: walletStateRepo,
        },
      ],
    }).compile();

    service = module.get<WalletManagerService>(WalletManagerService);
    keyVaultService = module.get(KeyVaultService);
  });

  describe('onModuleInit', () => {
    it('should initialize with default round-robin strategy', async () => {
      await service.onModuleInit();
      // Service should initialize without errors
      expect(service).toBeDefined();
    });

    it('should load wallet states from database', async () => {
      await service.onModuleInit();
      expect(walletStateRepo.find).toHaveBeenCalledWith({
        where: { status: 'active' },
      });
    });
  });

  describe('selectWallet', () => {
    beforeEach(async () => {
      await service.onModuleInit();
    });

    it('should select a wallet for a chain', async () => {
      const mockProvider = {} as Provider;

      const result = await service.selectWallet(42161, mockProvider);

      expect(result).toBeDefined();
      expect(result).toHaveProperty('keyId');
      expect(result).toHaveProperty('address');
      expect(result).toHaveProperty('wallet');
    });

    it('should throw when no wallets available for chain', async () => {
      keyVaultService.getWalletKeysByChain.mockReturnValue([]);

      const mockProvider = {} as Provider;

      await expect(service.selectWallet(99999 as unknown as ChainId, mockProvider)).rejects.toThrow(
        'No active wallets available for chain 99999',
      );
    });

    it('should call decryptPrivateKey to get wallet instance', async () => {
      const mockProvider = {} as Provider;

      await service.selectWallet(42161, mockProvider);

      expect(keyVaultService.retrieveEncryptedKey).toHaveBeenCalled();
      expect(keyVaultService.decryptPrivateKey).toHaveBeenCalled();
    });

    it('should update key last used timestamp', async () => {
      const mockProvider = {} as Provider;

      await service.selectWallet(42161, mockProvider);

      expect(keyVaultService.updateKeyLastUsed).toHaveBeenCalled();
    });

    // D4-B-4-KEYS (K1.2): Wallet instances must NOT be cached for the process
    // lifetime. Two selections should each decrypt the key fresh.
    it('should NOT cache the Wallet — each selection decrypts fresh (no long-lived plaintext)', async () => {
      const mockProvider = {} as Provider;

      await service.selectWallet(42161, mockProvider);
      await service.selectWallet(42161, mockProvider);

      // retrieveEncryptedKey + decryptPrivateKey called once PER selection (2x),
      // proving the wallet is rebuilt per call rather than cached.
      expect(keyVaultService.retrieveEncryptedKey).toHaveBeenCalledTimes(2);
      expect(keyVaultService.decryptPrivateKey).toHaveBeenCalledTimes(2);
    });
  });

  describe('wallet selection strategies', () => {
    beforeEach(async () => {
      await service.onModuleInit();
    });

    it('should use round-robin by default', async () => {
      const mockProvider = {} as Provider;

      // First call should select key-1
      const result1 = await service.selectWallet(42161, mockProvider);
      expect(result1.keyId).toBe('key-1');

      // Second call should select key-2 (round-robin)
      const result2 = await service.selectWallet(42161, mockProvider);
      expect(result2.keyId).toBe('key-2');
    });
  });

  describe('balance-based selection (D4-B-4-KEYS: no per-candidate decrypt)', () => {
    beforeEach(async () => {
      await service.onModuleInit();
      process.env.WALLET_SELECTION_STRATEGY = 'balance-based';
    });

    afterEach(() => {
      delete process.env.WALLET_SELECTION_STRATEGY;
    });

    it('should check balances via public address and only decrypt the selected key', async () => {
      // Re-create the module so the balance-based strategy is picked up from env.
      getArbibotMetricsRegistry().clear();
      const balanceMockVault = {
        getWalletKeysByChain: jest.fn().mockReturnValue(mockWalletKeys),
        getWalletKey: jest.fn().mockReturnValue(mockWalletKeys[0]),
        retrieveEncryptedKey: jest.fn().mockResolvedValue(mockEncryptedKey),
        decryptPrivateKey: jest.fn().mockResolvedValue('0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef'),
        updateKeyLastUsed: jest.fn().mockResolvedValue(undefined),
      };
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          WalletManagerService,
          { provide: KeyVaultService, useValue: balanceMockVault },
          {
            provide: getRepositoryToken(WalletState),
            useValue: {
              find: jest.fn().mockResolvedValue([]),
              findOne: jest.fn().mockResolvedValue(null),
              create: jest.fn().mockReturnValue({}),
              save: jest.fn().mockResolvedValue({}),
            },
          },
        ],
      }).compile();
      const balanceService = module.get<WalletManagerService>(WalletManagerService);
      await balanceService.onModuleInit();

      const mockProvider = {} as Provider;
      const result = await balanceService.selectWallet(
        42161,
        mockProvider,
        '0xtoken1234567890abcdef1234567890abcdef12',
        BigInt('500000000000000000'),
      );

      // The first candidate has sufficient balance (mock returns 1e18), so it is
      // selected. decryptPrivateKey is called exactly ONCE — for the selected
      // key only, never for balance-checking candidates.
      expect(result.keyId).toBe('key-1');
      expect(balanceMockVault.decryptPrivateKey).toHaveBeenCalledTimes(1);
    });
  });

  describe('getTokenBalance', () => {
    it('should return token balance for address', async () => {
      const mockProvider = {} as Provider;
      const address = '0x1234567890abcdef1234567890abcdef12345678' as Address;
      const tokenAddress = '0xtoken1234567890abcdef1234567890abcdef12' as Address;

      const balance = await service.getTokenBalance(mockProvider, address, tokenAddress);

      expect(typeof balance).toBe('bigint');
    });
  });

  describe('hasSufficientBalance', () => {
    it('should return true when balance is sufficient', async () => {
      const mockProvider = {} as Provider;
      const address = '0x1234567890abcdef1234567890abcdef12345678' as Address;
      const tokenAddress = '0xtoken1234567890abcdef1234567890abcdef12' as Address;

      const result = await service.hasSufficientBalance(
        mockProvider,
        address,
        tokenAddress,
        BigInt('500000000000000000'),
      );

      expect(result).toBe(true);
    });

    it('should return false when balance check fails', async () => {
      // Force balanceOf to throw
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { Contract } = require('ethers');
      Contract.mockImplementationOnce(() => ({
        balanceOf: jest.fn().mockRejectedValue(new Error('RPC error')),
      }));

      const mockProvider = {} as Provider;
      const address = '0x1234567890abcdef1234567890abcdef12345678' as Address;
      const tokenAddress = '0xtoken1234567890abcdef1234567890abcdef12' as Address;

      const result = await service.hasSufficientBalance(
        mockProvider,
        address,
        tokenAddress,
        BigInt('500000000000000000'),
      );

      expect(result).toBe(false);
    });
  });

  describe('additional coverage paths', () => {
    beforeEach(async () => {
      await service.onModuleInit();
    });

    it('throws when no wallet has sufficient balance (balance-based)', async () => {
      process.env.WALLET_SELECTION_STRATEGY = 'balance-based';
      getArbibotMetricsRegistry().clear();
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { Contract } = require('ethers');
      Contract.mockImplementation(() => ({
        balanceOf: jest.fn().mockResolvedValue(BigInt('100')), // very low
      }));

      const balanceMockVault = {
        getWalletKeysByChain: jest.fn().mockReturnValue(mockWalletKeys),
        getWalletKey: jest.fn().mockReturnValue(mockWalletKeys[0]),
        retrieveEncryptedKey: jest.fn().mockResolvedValue(mockEncryptedKey),
        decryptPrivateKey: jest.fn().mockResolvedValue('0x' + 'a'.repeat(64)),
        updateKeyLastUsed: jest.fn().mockResolvedValue(undefined),
      };
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          WalletManagerService,
          { provide: KeyVaultService, useValue: balanceMockVault },
          {
            provide: getRepositoryToken(WalletState),
            useValue: {
              find: jest.fn().mockResolvedValue([]),
              findOne: jest.fn().mockResolvedValue(null),
              create: jest.fn().mockReturnValue({}),
              save: jest.fn().mockResolvedValue({}),
            },
          },
        ],
      }).compile();
      const svc = module.get<WalletManagerService>(WalletManagerService);
      await svc.onModuleInit();

      const mockProvider = {} as Provider;
      await expect(
        svc.selectWallet(
          42161,
          mockProvider,
          '0xtoken1234567890abcdef1234567890abcdef12',
          BigInt('1000000000000000000'),
        ),
      ).rejects.toThrow('No wallet has sufficient balance');

      delete process.env.WALLET_SELECTION_STRATEGY;
    });

    it('selectByBalance swallows individual balanceOf errors', async () => {
      process.env.WALLET_SELECTION_STRATEGY = 'balance-based';
      getArbibotMetricsRegistry().clear();
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { Contract } = require('ethers');
      let call = 0;
      Contract.mockImplementation(() => ({
        // First wallet fails, second wallet has enough
        balanceOf: call++ === 0
          ? jest.fn().mockRejectedValue(new Error('rpc fail'))
          : jest.fn().mockResolvedValue(BigInt('1000000000000000000')),
      }));

      const balanceMockVault = {
        getWalletKeysByChain: jest.fn().mockReturnValue(mockWalletKeys),
        getWalletKey: jest.fn().mockReturnValue(mockWalletKeys[1]),
        retrieveEncryptedKey: jest.fn().mockResolvedValue(mockEncryptedKey),
        decryptPrivateKey: jest.fn().mockResolvedValue('0x' + 'a'.repeat(64)),
        updateKeyLastUsed: jest.fn().mockResolvedValue(undefined),
      };
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          WalletManagerService,
          { provide: KeyVaultService, useValue: balanceMockVault },
          {
            provide: getRepositoryToken(WalletState),
            useValue: {
              find: jest.fn().mockResolvedValue([]),
              findOne: jest.fn().mockResolvedValue(null),
              create: jest.fn().mockReturnValue({}),
              save: jest.fn().mockResolvedValue({}),
            },
          },
        ],
      }).compile();
      const svc = module.get<WalletManagerService>(WalletManagerService);
      await svc.onModuleInit();

      const mockProvider = {} as Provider;
      const result = await svc.selectWallet(
        42161,
        mockProvider,
        '0xtoken1234567890abcdef1234567890abcdef12',
        BigInt('500000000000000000'),
      );

      expect(result).toBeDefined();

      delete process.env.WALLET_SELECTION_STRATEGY;
    });

    it('uses weighted strategy when WALLET_SELECTION_STRATEGY=weighted', async () => {
      process.env.WALLET_SELECTION_STRATEGY = 'weighted';
      getArbibotMetricsRegistry().clear();

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          WalletManagerService,
          {
            provide: KeyVaultService,
            useValue: {
              getWalletKeysByChain: jest.fn().mockReturnValue([
                { keyId: 'k1', address: '0x' + 'a'.repeat(40), chainId: 42161, isActive: true, lastUsedAt: new Date('2026-01-05') },
                { keyId: 'k2', address: '0x' + 'b'.repeat(40), chainId: 42161, isActive: true, lastUsedAt: new Date('2026-01-01') },
              ]),
              getWalletKey: jest.fn().mockReturnValue({ keyId: 'k2', chainId: 42161 }),
              retrieveEncryptedKey: jest.fn().mockResolvedValue(mockEncryptedKey),
              decryptPrivateKey: jest.fn().mockResolvedValue('0x' + 'c'.repeat(64)),
              updateKeyLastUsed: jest.fn().mockResolvedValue(undefined),
            },
          },
          {
            provide: getRepositoryToken(WalletState),
            useValue: {
              find: jest.fn().mockResolvedValue([]),
              findOne: jest.fn().mockResolvedValue(null),
              create: jest.fn().mockReturnValue({}),
              save: jest.fn().mockResolvedValue({}),
            },
          },
        ],
      }).compile();
      const svc = module.get<WalletManagerService>(WalletManagerService);
      await svc.onModuleInit();

      const result = await svc.selectWallet(42161, {} as Provider);
      // Weighted picks least-recently-used → k2 (older lastUsedAt)
      expect(result.keyId).toBe('k2');

      delete process.env.WALLET_SELECTION_STRATEGY;
    });

    it('uses weighted fallback when balance-based strategy set but no minBalance/tokenAddress', async () => {
      process.env.WALLET_SELECTION_STRATEGY = 'balance-based';
      getArbibotMetricsRegistry().clear();

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          WalletManagerService,
          {
            provide: KeyVaultService,
            useValue: {
              getWalletKeysByChain: jest.fn().mockReturnValue([
                { keyId: 'k1', address: '0x' + 'a'.repeat(40), chainId: 42161, isActive: true, lastUsedAt: new Date('2026-01-05') },
                { keyId: 'k2', address: '0x' + 'b'.repeat(40), chainId: 42161, isActive: true, lastUsedAt: new Date('2026-01-01') },
              ]),
              getWalletKey: jest.fn().mockReturnValue({ keyId: 'k2', chainId: 42161 }),
              retrieveEncryptedKey: jest.fn().mockResolvedValue(mockEncryptedKey),
              decryptPrivateKey: jest.fn().mockResolvedValue('0x' + 'c'.repeat(64)),
              updateKeyLastUsed: jest.fn().mockResolvedValue(undefined),
            },
          },
          {
            provide: getRepositoryToken(WalletState),
            useValue: {
              find: jest.fn().mockResolvedValue([]),
              findOne: jest.fn().mockResolvedValue(null),
              create: jest.fn().mockReturnValue({}),
              save: jest.fn().mockResolvedValue({}),
            },
          },
        ],
      }).compile();
      const svc = module.get<WalletManagerService>(WalletManagerService);
      await svc.onModuleInit();

      // No tokenAddress/minBalance → falls back to weighted (LRU)
      const result = await svc.selectWallet(42161, {} as Provider);
      expect(result.keyId).toBe('k2');

      delete process.env.WALLET_SELECTION_STRATEGY;
    });

    it('getWalletBalanceInfo returns formatted balance + chainId', async () => {
      const mockProvider = {
        getNetwork: jest.fn().mockResolvedValue({ chainId: 42161n }),
      } as unknown as Provider;
      const result = await service.getWalletBalanceInfo(
        mockProvider,
        '0x' + 'a'.repeat(40) as Address,
        '0x' + 'b'.repeat(40) as Address,
        'USDC',
        6,
      );
      expect(result.tokenSymbol).toBe('USDC');
      expect(result.chainId).toBe(42161);
      expect(typeof result.formattedBalance).toBe('string');
    });

    it('getTokenBalance rethrows on contract error', async () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { Contract } = require('ethers');
      Contract.mockImplementationOnce(() => ({
        balanceOf: jest.fn().mockRejectedValue(new Error('contract fail')),
      }));
      const mockProvider = {} as Provider;
      await expect(
        service.getTokenBalance(
          mockProvider,
          '0x' + 'a'.repeat(40) as Address,
          '0x' + 'b'.repeat(40) as Address,
        ),
      ).rejects.toThrow('contract fail');
    });

    it('throws when encryptedKey is missing for selected key', async () => {
      keyVaultService.retrieveEncryptedKey.mockResolvedValueOnce(
        undefined,
      );
      await expect(
        service.selectWallet(42161, {} as Provider),
      ).rejects.toThrow(/Encrypted key not found/);
    });

    it('updateWalletState updates existing row when found', async () => {
      walletStateRepo.findOne.mockResolvedValueOnce({
        walletAddress: '0x' + 'a'.repeat(40),
        chainId: 42161,
        nonce: 5,
        status: 'active',
      });
      // Trigger selectWallet which calls updateWalletState
      await service.selectWallet(42161, {} as Provider);
      // Wait for the void updateWalletState promise to settle
      await new Promise((r) => setImmediate(r));
      expect(walletStateRepo.save).toHaveBeenCalled();
    });

    it('updateWalletState no-ops when getWalletKey returns undefined', async () => {
      keyVaultService.getWalletKey.mockReturnValueOnce(undefined);
      await service.selectWallet(42161, {} as Provider);
      await new Promise((r) => setImmediate(r));
      // save should NOT have been called for the missing-keyId branch
      expect(walletStateRepo.save).not.toHaveBeenCalled();
    });

    it('updateWalletState swallows errors from save', async () => {
      walletStateRepo.save.mockRejectedValueOnce(new Error('db down'));
      // selectWallet should still succeed (updateWalletState is fire-and-forget)
      const result = await service.selectWallet(42161, {} as Provider);
      expect(result).toBeDefined();
      await new Promise((r) => setImmediate(r));
    });
  });
});
