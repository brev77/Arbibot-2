import { Test, TestingModule } from '@nestjs/testing';
import { getArbibotMetricsRegistry } from '@arbibot/nest-platform';
import { RpcProviderManager } from './rpc-provider-manager.service';

// Mock ethers at the module level
jest.mock('ethers', () => ({
  JsonRpcProvider: jest.fn().mockImplementation(() => ({
    getBlockNumber: jest.fn().mockResolvedValue(12345),
  })),
  FallbackProvider: jest.fn().mockImplementation(() => ({
    getBlockNumber: jest.fn().mockResolvedValue(12345),
  })),
}));

describe('RpcProviderManager', () => {
  let service: RpcProviderManager;
  const originalEnv = process.env;

  beforeEach(async () => {
    jest.clearAllMocks();
    getArbibotMetricsRegistry().clear();

    // Set up env vars for testing
    process.env = {
      ...originalEnv,
      RPC_ARBITRUM_MAINNET_URL: 'https://arb-mainnet.example.com',
      RPC_ARBITRUM_MAINNET_BACKUP_URL: 'https://arb-mainnet-backup.example.com',
      RPC_BASE_MAINNET_URL: 'https://base-mainnet.example.com',
      RPC_BNB_TESTNET_URL: 'https://bnb-testnet.example.com',
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [RpcProviderManager],
    }).compile();

    service = module.get<RpcProviderManager>(RpcProviderManager);
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe('onModuleInit', () => {
    it('should initialize providers from env vars', async () => {
      await service.onModuleInit();

      // Should have providers for configured chains
      const status = service.getAllHealthStatus();
      expect(status.size).toBeGreaterThanOrEqual(3); // arb, base, bnb
    });

    it('should skip chains without RPC URL', async () => {
      // Remove all env vars except one
      delete process.env.RPC_BASE_MAINNET_URL;
      delete process.env.RPC_BNB_TESTNET_URL;

      await service.onModuleInit();

      const status = service.getAllHealthStatus();
      // Only Arbitrum mainnet should be configured (with backup)
      expect(status.has(42161)).toBe(true);
    });

    it('should start health checks', async () => {
      await service.onModuleInit();
      // Health checks run in background - just verify service is initialized
      expect(service.getAllHealthStatus().size).toBeGreaterThan(0);
    });
  });

  describe('getProvider', () => {
    it('should return provider for configured chain', async () => {
      await service.onModuleInit();

      const provider = service.getProvider(42161);
      expect(provider).toBeDefined();
    });

    it('should throw for unconfigured chain', async () => {
      await service.onModuleInit();

      expect(() => service.getProvider(99999)).toThrow(
        'No RPC provider configured for chain 99999',
      );
    });

    it('should return combined provider when backup is configured', async () => {
      await service.onModuleInit();

      // Chain 42161 has backup configured
      const provider = service.getProvider(42161);
      expect(provider).toBeDefined();
    });
  });

  describe('getHealthStatus', () => {
    it('should return health status for a chain', async () => {
      await service.onModuleInit();

      const status = service.getHealthStatus(42161);
      expect(status).toBeDefined();
      expect(status).toHaveProperty('healthy');
      expect(status).toHaveProperty('latency');
    });

    it('should return undefined for unconfigured chain', async () => {
      await service.onModuleInit();

      const status = service.getHealthStatus(99999);
      expect(status).toBeUndefined();
    });
  });

  describe('getAllHealthStatus', () => {
    it('should return all health statuses', async () => {
      await service.onModuleInit();

      const allStatus = service.getAllHealthStatus();
      expect(allStatus).toBeInstanceOf(Map);
      expect(allStatus.size).toBeGreaterThan(0);
    });
  });

  describe('onModuleDestroy', () => {
    it('should clean up providers', async () => {
      await service.onModuleInit();
      await service.onModuleDestroy();

      // After destroy, no providers should remain
      // The health status map should be cleared
      const allStatus = service.getAllHealthStatus();
      expect(allStatus.size).toBe(0);
    });
  });
});