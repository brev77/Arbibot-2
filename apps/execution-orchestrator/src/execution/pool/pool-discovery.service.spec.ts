 
// jest.mock is auto-hoisted by jest above imports, so it takes effect before
// `ethers` is imported by the service. `Contract` is replaced with a jest.fn
// we control per-test; other ethers exports stay real.
jest.mock('ethers', () => {
  const actual = jest.requireActual('ethers');
  return {
    ...actual,
    Contract: jest.fn(),
  };
});

import { Test } from '@nestjs/testing';
import { getArbibotMetricsRegistry } from '@arbibot/nest-platform';
import { Contract } from 'ethers';

import { PoolDiscoveryService } from './pool-discovery.service';
import { RpcProviderManager } from '../rpc/rpc-provider-manager.service';

const MockedContract = Contract as unknown as jest.Mock;

describe('PoolDiscoveryService', () => {
  let service: PoolDiscoveryService;

  const mockProvider = {
    getBlockNumber: jest.fn().mockResolvedValue(12345),
  };

  async function buildService(
    rpcOverrides: Partial<RpcProviderManager> = {},
  ): Promise<PoolDiscoveryService> {
    const module = await Test.createTestingModule({
      providers: [
        PoolDiscoveryService,
        {
          provide: RpcProviderManager,
          useValue: {
            getProvider: jest.fn().mockReturnValue(mockProvider),
            getHealthStatus: jest.fn().mockReturnValue({ healthy: true, latency: 10 }),
            ...rpcOverrides,
          },
        },
      ],
    }).compile();

    const svc = module.get(PoolDiscoveryService);
    svc.onModuleInit();
    return svc;
  }

  beforeEach(async () => {
    getArbibotMetricsRegistry().clear();
    MockedContract.mockReset();
    mockProvider.getBlockNumber.mockResolvedValue(12345);
    service = await buildService();
  });

  afterEach(() => {
    service.onModuleDestroy();
    delete process.env.POOL_DISCOVERY_ENABLED;
    delete process.env.POOL_CACHE_TTL_MS;
    delete process.env.POOL_DISCOVERY_INTERVAL_MS;
  });

  describe('onModuleInit', () => {
    it('initializes service without discovery loop when env not set', () => {
      expect(service).toBeDefined();
    });

    it('starts discovery loop when POOL_DISCOVERY_ENABLED=true', async () => {
      process.env.POOL_DISCOVERY_ENABLED = 'true';
      const svc = await buildService();
      // timer should be scheduled (not crash)
      expect(svc).toBeDefined();
      svc.onModuleDestroy();
    });

    it('initializes metrics idempotently (try/catch on re-registration)', async () => {
      // Second service instance on the same registry should not throw
      const svc2 = await buildService();
      expect(svc2).toBeDefined();
    });
  });

  describe('onModuleDestroy', () => {
    it('handles being called when no timer scheduled', () => {
      expect(() => service.onModuleDestroy()).not.toThrow();
    });
  });

  describe('getPool / cache', () => {
    it('returns null for unknown pool (UniV2 + UniV3 both fail)', async () => {
      MockedContract.mockImplementation(() => {
        throw new Error('not a contract');
      });

      const result = await service.getPool(42161, '0xUnknownPool');
      expect(result).toBeNull();
    });

    it('returns null when getProvider throws', async () => {
      // Override the existing rpc mock on the live service (avoids creating a
      // second service instance that can't re-initialize metrics on the
      // shared registry — metric re-registration is a try/catch no-op).
      const rpcField = service as unknown as {
        rpcProviderManager: { getProvider: jest.Mock };
      };
      rpcField.rpcProviderManager.getProvider.mockImplementationOnce(() => {
        throw new Error('provider missing');
      });
      const result = await service.getPool(42161, '0xPoolA');
      expect(result).toBeNull();
    });

    it('discovers UniV2 pool (token0/token1/getReserves/factory)', async () => {
      MockedContract.mockImplementation(() => ({
        token0: jest.fn().mockResolvedValue('0xtokena'),
        token1: jest.fn().mockResolvedValue('0xtokenb'),
        getReserves: jest.fn().mockResolvedValue([1000n, 2000n, 0]),
        factory: jest.fn().mockResolvedValue('0xfactory'),
      }));

      const result = await service.getPool(42161, '0xPoolV2');
      expect(result).not.toBeNull();
      expect(result?.protocol).toBe('uniswap-v2');
      expect(result?.token0).toBe('0xtokena');
      expect(result?.token1).toBe('0xtokenb');
      expect(result?.reserve0).toBe(1000n);
      expect(result?.reserve1).toBe(2000n);
      expect(result?.feeBps).toBe(30);
      expect(result?.factory).toBe('0xfactory');
      expect(result?.chainId).toBe(42161);
      expect(result?.blockNumber).toBe(12345);
    });

    it('uses zero-address factory when factory() rejects', async () => {
      MockedContract.mockImplementation(() => ({
        token0: jest.fn().mockResolvedValue('0xtokena'),
        token1: jest.fn().mockResolvedValue('0xtokenb'),
        getReserves: jest.fn().mockResolvedValue([100n, 200n, 0]),
        factory: jest.fn().mockRejectedValue(new Error('no factory')),
      }));

      const result = await service.getPool(42161, '0xPoolV2NoFactory');
      expect(result).not.toBeNull();
      expect(result?.factory).toBe('0x0000000000000000000000000000000000000000');
    });

    it('discovers UniV3 pool when UniV2 path fails', async () => {
      let callCount = 0;
      MockedContract.mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          // UniV2 path: token0() throws synchronously (avoids unhandled
          // rejection from mockRejectedValue when Promise.all short-circuits).
          return {
            token0: jest.fn().mockImplementation(() => {
              throw new Error('not v2');
            }),
            token1: jest.fn(),
            getReserves: jest.fn(),
            factory: jest.fn(),
          };
        }
        // UniV3 path
        return {
          token0: jest.fn().mockResolvedValue('0xt0'),
          token1: jest.fn().mockResolvedValue('0xt1'),
          fee: jest.fn().mockResolvedValue(3000),
          liquidity: jest.fn().mockResolvedValue(5000n),
          factory: jest.fn().mockResolvedValue('0xfactoryv3'),
        };
      });

      const result = await service.getPool(42161, '0xPoolV3');
      expect(result).not.toBeNull();
      expect(result?.protocol).toBe('uniswap-v3');
      expect(result?.feeBps).toBe(30); // 3000 / 100
      expect(result?.reserve0).toBe(5000n);
      expect(result?.reserve1).toBe(5000n);
    });

    it('uses zero-address factory when V3 factory() rejects', async () => {
      let callCount = 0;
      MockedContract.mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return {
            token0: jest.fn().mockImplementation(() => {
              throw new Error('not v2');
            }),
            token1: jest.fn(),
            getReserves: jest.fn(),
            factory: jest.fn(),
          };
        }
        return {
          token0: jest.fn().mockResolvedValue('0xt0'),
          token1: jest.fn().mockResolvedValue('0xt1'),
          fee: jest.fn().mockResolvedValue(500),
          liquidity: jest.fn().mockResolvedValue(1000n),
          factory: jest.fn().mockRejectedValue(new Error('no factory')),
        };
      });

      const result = await service.getPool(42161, '0xPoolV3NoFactory');
      expect(result?.factory).toBe('0x0000000000000000000000000000000000000000');
    });

    it('returns null when neither UniV2 nor UniV3 pattern matches', async () => {
      MockedContract.mockImplementation(() => {
        throw new Error('not a pool');
      });

      const result = await service.getPool(42161, '0xNotAPool');
      expect(result).toBeNull();
    });

    it('serves subsequent getPool from cache', async () => {
      MockedContract.mockImplementation(() => ({
        token0: jest.fn().mockResolvedValue('0xtokena'),
        token1: jest.fn().mockResolvedValue('0xtokenb'),
        getReserves: jest.fn().mockResolvedValue([100n, 200n, 0]),
        factory: jest.fn().mockResolvedValue('0xfactory'),
      }));

      // First call discovers and caches
      const r1 = await service.getPool(42161, '0xCachedPool');
      expect(r1).not.toBeNull();

      // Second call should hit cache (Contract not called again)
      MockedContract.mockClear();
      const r2 = await service.getPool(42161, '0xCachedPool');
      expect(r2).toEqual(r1);
      expect(MockedContract).not.toHaveBeenCalled();
    });

    it('returns empty array for chain with no cached pools', () => {
      expect(service.getCachedPools(99998 as never)).toEqual([]);
    });

    it('getCachedPools returns cached pools for matching chain', async () => {
      MockedContract.mockImplementation(() => ({
        token0: jest.fn().mockResolvedValue('0xtokena'),
        token1: jest.fn().mockResolvedValue('0xtokenb'),
        getReserves: jest.fn().mockResolvedValue([100n, 200n, 0]),
        factory: jest.fn().mockResolvedValue('0xfactory'),
      }));

      await service.getPool(42161, '0xPoolForList');
      const pools = service.getCachedPools(42161);
      expect(pools).toHaveLength(1);
      expect(pools[0]?.address).toBe('0xPoolForList');
    });

    it('excludes expired entries from getCachedPools', async () => {
      process.env.POOL_CACHE_TTL_MS = '0';
      MockedContract.mockImplementation(() => ({
        token0: jest.fn().mockResolvedValue('0xtokena'),
        token1: jest.fn().mockResolvedValue('0xtokenb'),
        getReserves: jest.fn().mockResolvedValue([100n, 200n, 0]),
        factory: jest.fn().mockResolvedValue('0xfactory'),
      }));

      // POOL_CACHE_TTL_MS=0 — but cache sets expiresAt = now + 0 = now,
      // which is not > now, so entry is considered expired immediately.
      await service.getPool(42161, '0xShortTtlPool');
      const pools = service.getCachedPools(42161);
      expect(pools).toHaveLength(0);
    });
  });

  describe('startDiscoveryLoop / cleanupExpiredEntries', () => {
    it('uses custom POOL_DISCOVERY_INTERVAL_MS when set', async () => {
      process.env.POOL_DISCOVERY_ENABLED = 'true';
      process.env.POOL_DISCOVERY_INTERVAL_MS = '999999';
      const svc = await buildService();
      // Sanity: no throw, timer scheduled
      expect(svc).toBeDefined();
      svc.onModuleDestroy();
    });

    it('cleanupExpiredEntries deletes expired entries (via private call)', async () => {
      process.env.POOL_CACHE_TTL_MS = '1';
      MockedContract.mockImplementation(() => ({
        token0: jest.fn().mockResolvedValue('0xtokena'),
        token1: jest.fn().mockResolvedValue('0xtokenb'),
        getReserves: jest.fn().mockResolvedValue([100n, 200n, 0]),
        factory: jest.fn().mockResolvedValue('0xfactory'),
      }));

      await service.getPool(42161, '0xPoolCleanup');

      // Wait past TTL
      await new Promise((r) => setTimeout(r, 5));

      // Invoke cleanup directly (private method)
      (service as unknown as { cleanupExpiredEntries: () => void }).cleanupExpiredEntries();

      const pools = service.getCachedPools(42161);
      expect(pools).toHaveLength(0);
    });

    it('cleanupExpiredEntries is a no-op when no entries', () => {
      expect(() =>
        (service as unknown as { cleanupExpiredEntries: () => void }).cleanupExpiredEntries(),
      ).not.toThrow();
    });
  });
});
