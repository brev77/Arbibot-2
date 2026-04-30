import { Test, TestingModule } from '@nestjs/testing';
import { getArbibotMetricsRegistry } from '@arbibot/nest-platform';
import { WalletManagerService, WalletSelectionStrategy } from './wallet-manager.service';
import { KeyVaultService } from '@arbibot/nest-platform';
import { getRepositoryToken } from '@nestjs/typeorm';
import { WalletState } from '@arbibot/persistence';

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
    tag: 'ghi789',
    algorithm: 'aes-256-gcm',
    createdAt: new Date(),
  };

  beforeEach(async () => {
    getArbibotMetricsRegistry().clear();

    const mockKeyVaultService = {
      getWalletKeysByChain: jest.fn().mockReturnValue(mockWalletKeys),
      getWalletKey: jest.fn().mockReturnValue(mockWalletKeys[0]),
      retrieveEncryptedKey: jest.fn().mockReturnValue(mockEncryptedKey),
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
      const mockProvider = {} as any;

      const result = await service.selectWallet(42161, mockProvider);

      expect(result).toBeDefined();
      expect(result).toHaveProperty('keyId');
      expect(result).toHaveProperty('address');
      expect(result).toHaveProperty('wallet');
    });

    it('should throw when no wallets available for chain', async () => {
      keyVaultService.getWalletKeysByChain.mockReturnValue([]);

      const mockProvider = {} as any;

      await expect(service.selectWallet(99999, mockProvider)).rejects.toThrow(
        'No active wallets available for chain 99999',
      );
    });

    it('should call decryptPrivateKey to get wallet instance', async () => {
      const mockProvider = {} as any;

      await service.selectWallet(42161, mockProvider);

      expect(keyVaultService.retrieveEncryptedKey).toHaveBeenCalled();
      expect(keyVaultService.decryptPrivateKey).toHaveBeenCalled();
    });

    it('should update key last used timestamp', async () => {
      const mockProvider = {} as any;

      await service.selectWallet(42161, mockProvider);

      expect(keyVaultService.updateKeyLastUsed).toHaveBeenCalled();
    });
  });

  describe('wallet selection strategies', () => {
    beforeEach(async () => {
      await service.onModuleInit();
    });

    it('should use round-robin by default', async () => {
      const mockProvider = {} as any;

      // First call should select key-1
      const result1 = await service.selectWallet(42161, mockProvider);
      expect(result1.keyId).toBe('key-1');

      // Second call should select key-2 (round-robin)
      const result2 = await service.selectWallet(42161, mockProvider);
      expect(result2.keyId).toBe('key-2');
    });
  });

  describe('clearWalletCache', () => {
    it('should clear wallet cache without error', async () => {
      await service.onModuleInit();
      expect(() => service.clearWalletCache()).not.toThrow();
    });
  });

  describe('getTokenBalance', () => {
    it('should return token balance for address', async () => {
      const mockProvider = {} as any;
      const address = '0x1234567890abcdef1234567890abcdef12345678' as any;
      const tokenAddress = '0xtoken1234567890abcdef1234567890abcdef12' as any;

      const balance = await service.getTokenBalance(mockProvider, address, tokenAddress);

      expect(typeof balance).toBe('bigint');
    });
  });

  describe('hasSufficientBalance', () => {
    it('should return true when balance is sufficient', async () => {
      const mockProvider = {} as any;
      const address = '0x1234567890abcdef1234567890abcdef12345678' as any;
      const tokenAddress = '0xtoken1234567890abcdef1234567890abcdef12' as any;

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
      const { Contract } = require('ethers');
      Contract.mockImplementationOnce(() => ({
        balanceOf: jest.fn().mockRejectedValue(new Error('RPC error')),
      }));

      const mockProvider = {} as any;
      const address = '0x1234567890abcdef1234567890abcdef12345678' as any;
      const tokenAddress = '0xtoken1234567890abcdef1234567890abcdef12' as any;

      const result = await service.hasSufficientBalance(
        mockProvider,
        address,
        tokenAddress,
        BigInt('500000000000000000'),
      );

      expect(result).toBe(false);
    });
  });
});