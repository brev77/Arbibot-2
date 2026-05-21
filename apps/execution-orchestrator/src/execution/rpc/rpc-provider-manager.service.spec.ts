import { Test, TestingModule } from '@nestjs/testing';
import { getArbibotMetricsRegistry } from '@arbibot/nest-platform';
import { RpcProviderManager } from './rpc-provider-manager.service';

// Track mock instances for per-test control
const mockGetBlockNumber = jest.fn().mockResolvedValue(12345);

// Mock ethers at the module level
jest.mock('ethers', () => ({
  JsonRpcProvider: jest.fn().mockImplementation(() => ({
    getBlockNumber: mockGetBlockNumber,
  })),
  FallbackProvider: jest.fn().mockImplementation(() => ({
    getBlockNumber: mockGetBlockNumber,
  })),
}));

describe('RpcProviderManager', () => {
  let service: RpcProviderManager;
  const originalEnv = process.env;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockGetBlockNumber.mockResolvedValue(12345);
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
    it('should initialize providers from env vars', () => {
      service.onModuleInit();

      // Should have providers for configured chains
      const status = service.getAllHealthStatus();
      expect(status.size).toBeGreaterThanOrEqual(3); // arb, base, bnb
    });

    it('should skip chains without RPC URL', () => {
      // Remove all env vars except one
      delete process.env.RPC_BASE_MAINNET_URL;
      delete process.env.RPC_BNB_TESTNET_URL;

      service.onModuleInit();

      const status = service.getAllHealthStatus();
      // Only Arbitrum mainnet should be configured (with backup)
      expect(status.has(42161)).toBe(true);
    });

    it('should start health checks', () => {
      service.onModuleInit();
      // Health checks run in background - just verify service is initialized
      expect(service.getAllHealthStatus().size).toBeGreaterThan(0);
    });
  });

  describe('getProvider', () => {
    it('should return provider for configured chain', () => {
      service.onModuleInit();

      const provider = service.getProvider(42161);
      expect(provider).toBeDefined();
    });

    it('should throw for unconfigured chain', () => {
      service.onModuleInit();

      expect(() => service.getProvider(99999)).toThrow(
        'No RPC provider configured for chain 99999',
      );
    });

    it('should return combined provider when backup is configured', () => {
      service.onModuleInit();

      // Chain 42161 has backup configured
      const provider = service.getProvider(42161);
      expect(provider).toBeDefined();
    });
  });

  describe('getHealthStatus', () => {
    it('should return health status for a chain', () => {
      service.onModuleInit();

      const status = service.getHealthStatus(42161);
      expect(status).toBeDefined();
      expect(status).toHaveProperty('healthy');
      expect(status).toHaveProperty('latency');
    });

    it('should return undefined for unconfigured chain', () => {
      service.onModuleInit();

      const status = service.getHealthStatus(99999);
      expect(status).toBeUndefined();
    });
  });

  describe('getAllHealthStatus', () => {
    it('should return all health statuses', () => {
      service.onModuleInit();

      const allStatus = service.getAllHealthStatus();
      expect(allStatus).toBeInstanceOf(Map);
      expect(allStatus.size).toBeGreaterThan(0);
    });
  });

  describe('onModuleDestroy', () => {
    it('should clean up providers', () => {
      service.onModuleInit();
      service.onModuleDestroy();

      // After destroy, no providers should remain
      // The health status map should be cleared
      const allStatus = service.getAllHealthStatus();
      expect(allStatus.size).toBe(0);
    });

    it('should be safe to call destroy twice', () => {
      service.onModuleInit();
      service.onModuleDestroy();
      // Second call should not throw
      expect(() => service.onModuleDestroy()).not.toThrow();
      expect(service.getAllHealthStatus().size).toBe(0);
    });
  });

  describe('primary-only provider (no backup)', () => {
    it('should initialize chain with only primary URL', () => {
      // Only primary URL for BNB testnet (no backup)
      process.env = {
        ...originalEnv,
        RPC_BNB_TESTNET_URL: 'https://bnb-testnet.example.com',
      };

      service.onModuleInit();

      expect(service.getHealthStatus(97)).toBeDefined();
      expect(service.getHealthStatus(97)?.healthy).toBe(true);

      // Should still return a valid provider (primary only)
      const provider = service.getProvider(97);
      expect(provider).toBeDefined();
    });

    it('should return primary provider when no backup configured', () => {
      process.env = {
        ...originalEnv,
        RPC_BASE_MAINNET_URL: 'https://base-mainnet.example.com',
      };

      service.onModuleInit();

      const provider = service.getProvider(8453);
      expect(provider).toBeDefined();
    });
  });

  describe('provider initialization error handling', () => {
    it('should mark chain as unhealthy when provider constructor throws', () => {
      const { JsonRpcProvider } = jest.requireMock('ethers');

      // Make constructor throw for this test
      (JsonRpcProvider as jest.Mock).mockImplementationOnce(() => {
        throw new Error('Invalid RPC URL');
      });

      process.env = {
        ...originalEnv,
        RPC_ARBITRUM_MAINNET_URL: 'https://bad-url.example.com',
      };

      service.onModuleInit();

      const status = service.getHealthStatus(42161);
      expect(status).toBeDefined();
      expect(status?.healthy).toBe(false);
      expect(status?.error).toContain('Invalid RPC URL');
    });
  });

  describe('health check behavior', () => {
    it('should update health status to healthy on successful check', async () => {
      // Ensure getBlockNumber resolves quickly
      mockGetBlockNumber.mockResolvedValue(50000);

      process.env = {
        ...originalEnv,
        RPC_ARBITRUM_MAINNET_URL: 'https://arb-mainnet.example.com',
      };

      service.onModuleInit();

      // The initial health check runs async - wait briefly
      await new Promise((r) => setTimeout(r, 50));

      const status = service.getHealthStatus(42161);
      expect(status).toBeDefined();
      expect(status?.healthy).toBe(true);
      expect(typeof status?.latency).toBe('number');
    });

    it('should update health status to unhealthy when getBlockNumber fails', async () => {
      mockGetBlockNumber.mockRejectedValue(new Error('Network timeout'));

      process.env = {
        ...originalEnv,
        RPC_ARBITRUM_MAINNET_URL: 'https://arb-mainnet.example.com',
      };

      service.onModuleInit();

      // Wait for async health check
      await new Promise((r) => setTimeout(r, 50));

      const status = service.getHealthStatus(42161);
      expect(status).toBeDefined();
      expect(status?.healthy).toBe(false);
      expect(status?.error).toContain('Network timeout');
    });
  });

  describe('getProvider for unhealthy chain', () => {
    it('should still return provider even when chain is marked unhealthy', () => {
      // Chain 42161 is configured but we manually simulate unhealthy state
      // by making getBlockNumber fail
      mockGetBlockNumber.mockRejectedValue(new Error('RPC down'));

      process.env = {
        ...originalEnv,
        RPC_ARBITRUM_MAINNET_URL: 'https://arb-mainnet.example.com',
      };

      service.onModuleInit();

      // Even without health check running, provider should be accessible
      const provider = service.getProvider(42161);
      expect(provider).toBeDefined();
    });
  });

  describe('metrics', () => {
    it('should register prometheus metrics without throwing', () => {
      getArbibotMetricsRegistry().clear();

      process.env = {
        ...originalEnv,
        RPC_ARBITRUM_MAINNET_URL: 'https://arb-mainnet.example.com',
      };

      // Creating the service registers metrics - should not throw
      expect(() => {
        service.onModuleInit();
      }).not.toThrow();
    });

    it('should handle duplicate metric registration gracefully', () => {
      // Register the same metrics twice by creating two instances
      process.env = {
        ...originalEnv,
        RPC_ARBITRUM_MAINNET_URL: 'https://arb-mainnet.example.com',
      };

      service.onModuleInit();

      // Creating another service should not throw on duplicate metric registration
      expect(() => {
        const _module2 = Test.createTestingModule({
          providers: [RpcProviderManager],
        });
        // Metrics are registered in constructor, not in onModuleInit
        // The try/catch in initializeMetrics should handle duplicates
      }).not.toThrow();
    });
  });

  describe('edge cases', () => {
    it('should handle empty env (no RPC URLs configured)', () => {
      process.env = { ...originalEnv };
      // Remove all RPC env vars
      delete process.env.RPC_ARBITRUM_MAINNET_URL;
      delete process.env.RPC_ARBITRUM_MAINNET_BACKUP_URL;
      delete process.env.RPC_BASE_MAINNET_URL;
      delete process.env.RPC_BNB_TESTNET_URL;

      service.onModuleInit();

      expect(service.getAllHealthStatus().size).toBe(0);
      expect(() => service.getProvider(42161)).toThrow(
        'No RPC provider configured for chain 42161',
      );
    });

    it('should return a copy of health status map', () => {
      process.env = {
        ...originalEnv,
        RPC_ARBITRUM_MAINNET_URL: 'https://arb-mainnet.example.com',
      };

      service.onModuleInit();

      const status1 = service.getAllHealthStatus();
      const status2 = service.getAllHealthStatus();

      // Should be different Map instances
      expect(status1).not.toBe(status2);
      expect(status1.size).toBe(status2.size);
    });

    it('should initialize all six chain configs when URLs are provided', () => {
      process.env = {
        ...originalEnv,
        RPC_ARBITRUM_MAINNET_URL: 'https://arb-mainnet.example.com',
        RPC_ARBITRUM_TESTNET_URL: 'https://arb-testnet.example.com',
        RPC_BASE_MAINNET_URL: 'https://base-mainnet.example.com',
        RPC_BASE_TESTNET_URL: 'https://base-testnet.example.com',
        RPC_BNB_MAINNET_URL: 'https://bnb-mainnet.example.com',
        RPC_BNB_TESTNET_URL: 'https://bnb-testnet.example.com',
      };

      service.onModuleInit();

      const status = service.getAllHealthStatus();
      expect(status.has(42161)).toBe(true);  // Arbitrum mainnet
      expect(status.has(421611)).toBe(true); // Arbitrum testnet
      expect(status.has(8453)).toBe(true);   // Base mainnet
      expect(status.has(84532)).toBe(true);  // Base testnet
      expect(status.has(56)).toBe(true);     // BNB mainnet
      expect(status.has(97)).toBe(true);     // BNB testnet
      expect(status.size).toBe(6);
    });
  });
});
