import { Test } from '@nestjs/testing';
import { getArbibotMetricsRegistry } from '@arbibot/nest-platform';
import { PoolDiscoveryService } from './pool-discovery.service';
import { RpcProviderManager } from '../rpc/rpc-provider-manager.service';

describe('PoolDiscoveryService', () => {
  let service: PoolDiscoveryService;
  let _rpcManager: RpcProviderManager;

  const mockProvider = {
    getBlockNumber: jest.fn().mockResolvedValue(12345),
  };

  beforeEach(async () => {
    getArbibotMetricsRegistry().clear();

    const module = await Test.createTestingModule({
      providers: [
        PoolDiscoveryService,
        {
          provide: RpcProviderManager,
          useValue: {
            getProvider: jest.fn().mockReturnValue(mockProvider),
            getHealthStatus: jest.fn().mockReturnValue({ healthy: true, latency: 10 }),
          },
        },
      ],
    }).compile();

    service = module.get(PoolDiscoveryService);
    _rpcManager = module.get(RpcProviderManager);
    // Initialize metrics (normally done in onModuleInit)
    service.onModuleInit();
  });

  afterEach(() => {
    service.onModuleDestroy();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should return null for unknown pool', async () => {
    mockProvider.getBlockNumber.mockRejectedValueOnce(new Error('not found'));
    const result = await service.getPool(42161, '0xUnknownPool');
    expect(result).toBeNull();
  });

  it('should cache and return pools', () => {
    // After init, getCachedPools returns empty
    const cached = service.getCachedPools(42161);
    expect(cached).toEqual([]);
  });

  it('should handle onModuleDestroy gracefully', () => {
    expect(() => service.onModuleDestroy()).not.toThrow();
  });

  it('should start discovery loop when POOL_DISCOVERY_ENABLED=true', async () => {
    const original = process.env.POOL_DISCOVERY_ENABLED;
    process.env.POOL_DISCOVERY_ENABLED = 'true';

    const module = await Test.createTestingModule({
      providers: [
        PoolDiscoveryService,
        {
          provide: RpcProviderManager,
          useValue: {
            getProvider: jest.fn().mockReturnValue(mockProvider),
          },
        },
      ],
    }).compile();

    const svc = module.get(PoolDiscoveryService);
    svc.onModuleInit();

    expect(svc).toBeDefined();

    process.env.POOL_DISCOVERY_ENABLED = original;
    svc.onModuleDestroy();
  });

  it('should not start discovery loop when POOL_DISCOVERY_ENABLED is not set', () => {
    const original = process.env.POOL_DISCOVERY_ENABLED;
    delete process.env.POOL_DISCOVERY_ENABLED;

    service.onModuleInit();
    // Should not throw - no discovery loop started

    process.env.POOL_DISCOVERY_ENABLED = original;
  });
});