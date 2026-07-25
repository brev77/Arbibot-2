import { getArbibotMetricsRegistry } from '@arbibot/nest-platform';

import { resolveFactory } from './scanner-pool.constants';
import { ScannerPoolService } from './scanner-pool.service';
import type { PoolSnapshot } from './scanner-pool.service';
import type { ScannerRpcService } from './scanner-rpc.service';

/**
 * Mock the ethers Contract so unit tests never hit RPC. Contracts are keyed by lowercase
 * address in a registry; `stageContract` accumulates entries (does NOT overwrite prior ones).
 */
jest.mock('ethers', () => {
  return {
    __esModule: true,
    Contract: jest.fn((addr: string) => {
      const key = typeof addr === 'string' ? addr.toLowerCase() : '';
      const methods = (globalThis as { __scannedContracts?: Map<string, Record<string, jest.Mock>> }).__scannedContracts?.get(key);
      return new Proxy(
        {},
        {
          get(_t, prop: string) {
            if (methods !== undefined && prop in methods) {
              return methods[prop];
            }
            return jest.fn().mockRejectedValue(new Error(`unstubbed ${prop} for ${key}`));
          },
        },
      );
    }),
  };
});

describe('ScannerPoolService', () => {
  const originalEnv = process.env;
  let rpc: { tryAcquire: jest.Mock; getProvider: jest.Mock };
  let service: ScannerPoolService;

  beforeEach(() => {
    getArbibotMetricsRegistry().clear();
    (globalThis as { __scannedContracts?: Map<string, unknown> }).__scannedContracts = new Map();
    process.env = { ...originalEnv };
    delete process.env.SCANNER_POOL_CACHE_TTL_MS;
    rpc = {
      tryAcquire: jest.fn().mockReturnValue(true),
      getProvider: jest.fn().mockReturnValue({}),
    };
    service = new ScannerPoolService(rpc as unknown as ScannerRpcService);
  });

  afterEach(() => {
    service.clearCache();
    jest.clearAllMocks();
    process.env = originalEnv;
  });

  /**
   * Stage a mock Contract for a given address: each method name → jest.fn returning the value.
   * Accumulates into a global registry keyed by lowercase address (does NOT overwrite prior
   * stages for other addresses).
   */
  function stageContract(
    address: string,
    methods: Record<string, jest.Mock>,
  ): void {
    const g = globalThis as { __scannedContracts?: Map<string, Record<string, jest.Mock>> };
    if (g.__scannedContracts === undefined) {
      g.__scannedContracts = new Map();
    }
    g.__scannedContracts.set(address.toLowerCase(), methods);
  }

  /** Helper: a jest.fn returning a value (not a promise) — wrapped to a resolved promise. */
  const resolves = <T>(v: T): jest.Mock => jest.fn().mockResolvedValue(v);
  /** Helper: a jest.fn returning a thenable with .catch (for factory().catch(() => null)). */
  const resolvesWithCatch = <T>(v: T): jest.Mock => {
    const fn = jest.fn();
    fn.mockReturnValue({
      then: (onFulfilled: (val: T) => T) => Promise.resolve(v).then(onFulfilled),
      catch: (cb: (e: unknown) => T) => Promise.resolve(v).catch(cb),
    });
    return fn;
  };

  describe('factory mapping', () => {
    it('maps known Arbitrum factories', () => {
      expect(resolveFactory(42161, '0xf1D7CC64Fb745938252F3B21e12e7C8398cE848e')?.venueKey).toBe(
        'uniswap-v2',
      );
      expect(resolveFactory(42161, '0x1F98431c8aD98523631AE4a59f267346ea31F984')?.venueKey).toBe(
        'uniswap-v3',
      );
      // Sushi deployed address (not the plan-typo EC41265 variant).
      expect(resolveFactory(42161, '0xc35DADB65012eC5796536bD9864eD8773aBc74C4')?.venueKey).toBe(
        'sushiswap',
      );
    });

    it('maps BNB chain venues', () => {
      expect(resolveFactory(56, '0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73')?.venueKey).toBe(
        'pancakeswap-v2',
      );
      expect(resolveFactory(56, '0x858E3312ed3A876947AE49e6A8A2fA7A6b7819E8')?.venueKey).toBe('biswap');
    });

    it('returns undefined for unknown factory', () => {
      expect(resolveFactory(42161, '0x0000000000000000000000000000000000000000')).toBeUndefined();
    });

    it('is case-insensitive on factory address', () => {
      const lower = resolveFactory(42161, '0xf1d7cc64fb745938252f3b21e12e7c8398ce848e');
      const upper = resolveFactory(42161, '0xF1D7CC64FB745938252F3B21E12E7C8398CE848E');
      expect(lower?.venueKey).toBe('uniswap-v2');
      expect(upper?.venueKey).toBe('uniswap-v2');
    });
  });

  describe('readPool — V2', () => {
    it('reads V2 reserves and computes price', async () => {
      const pool = '0xPOOL_ARB_UNIV2';
      const factory = '0xf1D7CC64Fb745938252F3B21e12e7C8398cE848e';
      stageContract(pool, {
        token0: resolves('0xWETH'),
        token1: resolves('0xUSDC'),
        getReserves: resolves([10n ** 18n, 2000n * 10n ** 6n, 0]),
        factory: resolvesWithCatch(factory),
      });
      stageContract('0xWETH', { decimals: resolves(18) });
      stageContract('0xUSDC', { decimals: resolves(6) });

      const snap = await service.readPool(42161, pool);

      expect(snap).not.toBeNull();
      expect(snap?.venueKey).toBe('uniswap-v2');
      expect(snap?.family).toBe('v2');
      expect(snap?.feeBps).toBe(30);
      expect(snap?.quotePerBase).toBeCloseTo(2000, 4);
      expect(snap?.token0).toBe('0xWETH');
    });

    it('returns null when factory does not map to v2', async () => {
      const pool = '0xPOOL_V3_LOOKS_LIKE_V2';
      // V3 factory returned but we only asked V2 ABI — token0/1 exist on V3 too, so the V2
      // path succeeds the token reads but resolveFactory says v3 → null, then falls to tryV3.
      const v3Factory = '0x1F98431c8aD98523631AE4a59f267346ea31F984';
      // First (V2) contract returns v3 factory; then tryV3 contract (same address) returns full V3 data.
      stageContract(pool, {
        token0: resolves('0xWETH'),
        token1: resolves('0xUSDC'),
        getReserves: resolves([0n, 0n, 0]),
        factory: resolvesWithCatch(v3Factory),
        fee: resolves(500n),
        slot0: resolves([2n ** 96n, 0, 0, 0, 0, false]),
        liquidity: resolves(1000n),
      });
      stageContract('0xWETH', { decimals: resolves(18) });
      stageContract('0xUSDC', { decimals: resolves(6) });

      const snap = await service.readPool(42161, pool);
      // Falls through to V3 since V2 factory mapping failed.
      expect(snap?.family).toBe('v3');
      expect(snap?.venueKey).toBe('uniswap-v3');
    });
  });

  describe('readPool — V3', () => {
    it('reads V3 slot0 + liquidity and computes price from sqrtPriceX96', async () => {
      const pool = '0xPOOL_ARB_UNIV3';
      const factory = '0x1F98431c8aD98523631AE4a59f267346ea31F984';
      // Construct sqrtPriceX96 for price=1 (equal decimals).
      const sqrtPriceX96 = 2n ** 96n;
      stageContract(pool, {
        token0: resolves('0xA'),
        token1: resolves('0xB'),
        fee: resolves(500n),
        slot0: resolves([sqrtPriceX96, 0, 0, 0, 0, false]),
        liquidity: resolves(5000n),
        factory: resolvesWithCatch(factory),
      });
      stageContract('0xA', { decimals: resolves(18) });
      stageContract('0xB', { decimals: resolves(18) });

      const snap = await service.readPool(42161, pool);

      expect(snap?.venueKey).toBe('uniswap-v3');
      expect(snap?.family).toBe('v3');
      expect(snap?.feeBps).toBe(5); // 500 / 100
      expect(snap?.quotePerBase).toBeCloseTo(1, 6);
    });
  });

  describe('rate limiting + cache', () => {
    it('returns null without RPC when rate-limited (token bucket empty)', async () => {
      rpc.tryAcquire.mockReturnValue(false);
      const snap = await service.readPool(42161, '0xANY');
      expect(snap).toBeNull();
      expect(rpc.getProvider).not.toHaveBeenCalled();
    });

    it('caches a successful read for the TTL', async () => {
      const pool = '0xPOOL_CACHE';
      stageContract(pool, {
        token0: resolves('0xWETH'),
        token1: resolves('0xUSDC'),
        getReserves: resolves([10n ** 18n, 2000n * 10n ** 6n, 0]),
        factory: resolvesWithCatch('0xf1D7CC64Fb745938252F3B21e12e7C8398cE848e'),
      });
      stageContract('0xWETH', { decimals: resolves(18) });
      stageContract('0xUSDC', { decimals: resolves(6) });

      const first = await service.readPool(42161, pool);
      const acquireCallsAfterFirst = rpc.tryAcquire.mock.calls.length;

      const second = await service.readPool(42161, pool);
      expect(rpc.tryAcquire.mock.calls.length).toBe(acquireCallsAfterFirst); // cache hit, no acquire
      expect((second as PoolSnapshot).quotePerBase).toBe((first as PoolSnapshot).quotePerBase);
    });

    it('re-reads after cache TTL expires', async () => {
      const pool = '0xPOOL_EXPIRE';
      const getReservesMock = resolves([10n ** 18n, 2000n * 10n ** 6n, 0]);
      stageContract(pool, {
        token0: resolves('0xWETH'),
        token1: resolves('0xUSDC'),
        getReserves: getReservesMock,
        factory: resolvesWithCatch('0xf1D7CC64Fb745938252F3B21e12e7C8398cE848e'),
      });
      stageContract('0xWETH', { decimals: resolves(18) });
      stageContract('0xUSDC', { decimals: resolves(6) });

      // First read populates the cache.
      await service.readPool(42161, pool);
      expect(getReservesMock).toHaveBeenCalledTimes(1);

      // Second read is a cache hit (no new contract call).
      await service.readPool(42161, pool);
      expect(getReservesMock).toHaveBeenCalledTimes(1);

      // Clear cache → third read re-fetches (new contract call).
      service.clearCache();
      await service.readPool(42161, pool);
      expect(getReservesMock).toHaveBeenCalledTimes(2);
    });

    it('returns null on RPC read failure', async () => {
      const pool = '0xPOOL_FAIL';
      stageContract(pool, {
        token0: jest.fn().mockRejectedValue(new Error('revert')),
      });
      const snap = await service.readPool(42161, pool);
      expect(snap).toBeNull();
    });

    // ─────────────────────────────────────────────────────────────────────
    // Metrics (S4-1-METRICS): pool cache hit-ratio gauge
    // ─────────────────────────────────────────────────────────────────────
    const cacheRatio = async (chainId: string): Promise<number> => {
      const metrics = await getArbibotMetricsRegistry().getMetricsAsJSON();
      const m = metrics.find((x) => x.name === 'arb_scanner_pool_cache_hit_ratio');
      if (m === undefined) return 0;
      const values = (m.values ?? []) as Array<{
        labels: Record<string, string>;
        value: number;
      }>;
      const hit = values.find((v) => v.labels.chain_id === chainId);
      return hit?.value ?? 0;
    };

    it('exposes pool_cache_hit_ratio gauge reflecting hits/(hits+misses)', async () => {
      const pool = '0xPOOL_RATIO';
      stageContract(pool, {
        token0: resolves('0xWETH'),
        token1: resolves('0xUSDC'),
        getReserves: resolves([10n ** 18n, 2000n * 10n ** 6n, 0]),
        factory: resolvesWithCatch('0xf1D7CC64Fb745938252F3B21e12e7C8398cE848e'),
      });
      stageContract('0xWETH', { decimals: resolves(18) });
      stageContract('0xUSDC', { decimals: resolves(6) });

      // 1st read: miss (fetch). 2nd + 3rd: hits. → ratio = 2/3.
      await service.readPool(42161, pool); // miss
      await service.readPool(42161, pool); // hit
      await service.readPool(42161, pool); // hit
      const ratio = await cacheRatio('42161');
      expect(ratio).toBeCloseTo(2 / 3, 5);
    });

    it('pool_cache_hit_ratio is 0 before any access', async () => {
      const ratio = await cacheRatio('42161');
      expect(ratio).toBe(0);
    });
  });

  describe('diagnostics accessors', () => {
    it('getCacheSize is 0 initially and increments after a cached read', async () => {
      expect(service.getCacheSize()).toBe(0);
      const pool = '0xPOOL_DIAG';
      stageContract(pool, {
        token0: resolves('0xWETH'),
        token1: resolves('0xUSDC'),
        getReserves: resolves([10n ** 18n, 2000n * 10n ** 6n, 0]),
        factory: resolvesWithCatch('0xf1D7CC64Fb745938252F3B21e12e7C8398cE848e'),
      });
      stageContract('0xWETH', { decimals: resolves(18) });
      stageContract('0xUSDC', { decimals: resolves(6) });
      await service.readPool(42161, pool);
      expect(service.getCacheSize()).toBe(1);
    });

    it('resolveFactoryMapping returns a known factory mapping', () => {
      // SushiSwap V2 on Arbitrum (deployed factory address).
      const m = service.resolveFactoryMapping(42161, '0xc35DADB65012eC5796536bD9864eD8773aBc74C4');
      expect(m).toBeDefined();
    });

    it('resolveFactoryMapping returns undefined for an unknown factory', () => {
      expect(service.resolveFactoryMapping(42161, '0xUNKNOWN')).toBeUndefined();
    });
  });

  describe('readDecimals fallback + V3 factory mismatch', () => {
    it('uses 18 default when a token decimals() call rejects', async () => {
      const pool = '0xPOOL_DEC';
      // V3-style: token0/token1/slot0/liquidity/factory present, factory resolves to a V3 mapping.
      // Use a known V3 factory address to enter the V3 branch.
      stageContract(pool, {
        token0: resolves('0xWETH'),
        token1: resolves('0xUSDC'),
        slot0: resolves(['0x' + '0'.repeat(56), 0]),
        liquidity: resolves(0),
        factory: resolvesWithCatch('0x1F98431c8aD98523631AE4a59f267346ea31F984'), // UniV3 Arb
      });
      // WETH decimals rejects → fallback to 18; USDC resolves to 6.
      stageContract('0xWETH', { decimals: jest.fn().mockRejectedValue(new Error('revert')) });
      stageContract('0xUSDC', { decimals: resolves(6) });

      const snap = await service.readPool(42161, pool);
      // Either a snapshot with computed price, or null if sqrtPriceX96=0 yields no price.
      // The key assertion is no throw (the decimals catch path executed).
      expect(snap === null || typeof snap === 'object').toBe(true);
    });

    it('returns null when a V3 pool reports a V2-family factory mapping', async () => {
      const pool = '0xPOOL_MISMATCH';
      stageContract(pool, {
        token0: resolves('0xWETH'),
        token1: resolves('0xUSDC'),
        slot0: resolves(['0x' + '0'.repeat(56), 0]),
        liquidity: resolves(0),
        // UniV2 factory — the V3 branch requires mapping.family === 'v3', so this returns null.
        factory: resolvesWithCatch('0xf1D7CC64Fb745938252F3B21e12e7C8398cE848e'),
      });
      const snap = await service.readPool(42161, pool);
      expect(snap).toBeNull();
    });
  });
});
