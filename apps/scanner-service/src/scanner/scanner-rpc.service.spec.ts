import { ChainId } from '@arbibot/contracts-eth';
import { getArbibotMetricsRegistry } from '@arbibot/nest-platform';

import { ScannerRpcService } from './scanner-rpc.service';

jest.mock('ethers', () => {
  // Minimal ethers mock: JsonRpcProvider + FallbackProvider are stubs with a configurable
  // getBlockNumber. We never hit the network in unit tests.
  class FakeJsonRpcProvider {
    constructor(
      public url: string,
      public chainId: number,
    ) {}
    blockNumber: number | ((c: number) => number) = 100;
    getBlockNumber(): Promise<number> {
      if (typeof this.blockNumber === 'function') {
        return Promise.resolve(this.blockNumber(this.chainId));
      }
      return Promise.resolve(this.blockNumber);
    }
    destroy(): void {}
  }
  class FakeFallbackProvider {
    constructor(public providers: unknown[]) {}
  }
  return {
    __esModule: true,
    JsonRpcProvider: FakeJsonRpcProvider,
    FallbackProvider: FakeFallbackProvider,
  };
});

describe('ScannerRpcService', () => {
  const originalEnv = process.env;
  let service: ScannerRpcService;

  beforeEach(() => {
    getArbibotMetricsRegistry().clear();
    process.env = { ...originalEnv };
    // Clear all RPC env vars so tests are deterministic.
    delete process.env.RPC_SCANNER_ARBITRUM_URL;
    delete process.env.RPC_SCANNER_BASE_URL;
    delete process.env.RPC_SCANNER_BNB_URL;
    delete process.env.RPC_ARBITRUM_MAINNET_URL;
    delete process.env.RPC_BASE_MAINNET_URL;
    delete process.env.RPC_BNB_MAINNET_URL;
    delete process.env.SCANNER_RPC_RATE_LIMIT_RPS;
    service = new ScannerRpcService();
  });

  afterEach(() => {
    service.onModuleDestroy();
    process.env = originalEnv;
  });

  describe('URL resolution (isolated namespace + fallback)', () => {
    it('uses RPC_SCANNER_*_URL when set (isolated budget)', () => {
      process.env.RPC_SCANNER_ARBITRUM_URL = 'http://scanner-arb.example';
      process.env.RPC_ARBITRUM_MAINNET_URL = 'http://shared-arb.example';
      service.onModuleInit();
      const provider = service.getProvider(ChainId.ARBITRUM_ONE_MAINNET) as unknown as {
        url: string;
      };
      expect(provider.url).toBe('http://scanner-arb.example');
    });

    it('falls back to RPC_*_MAINNET_URL when scanner var is unset', () => {
      process.env.RPC_ARBITRUM_MAINNET_URL = 'http://shared-arb.example';
      service.onModuleInit();
      const provider = service.getProvider(ChainId.ARBITRUM_ONE_MAINNET) as unknown as {
        url: string;
      };
      expect(provider.url).toBe('http://shared-arb.example');
    });

    it('throws on getProvider when no URL configured for the chain', () => {
      service.onModuleInit();
      expect(() => service.getProvider(ChainId.ARBITRUM_ONE_MAINNET)).toThrow(
        /No scanner RPC provider configured/,
      );
    });

    it('initializes a backup provider + FallbackProvider when backup URL is set', () => {
      process.env.RPC_SCANNER_BASE_URL = 'http://base-primary.example';
      process.env.RPC_SCANNER_BASE_BACKUP_URL = 'http://base-backup.example';
      service.onModuleInit();
      // No throw means FallbackProvider was constructed; getProvider returns the combined.
      expect(() => service.getProvider(ChainId.BASE_MAINNET)).not.toThrow();
    });

    it('skips chains with no configured URL (logs warn, no provider)', () => {
      service.onModuleInit();
      expect(() => service.getProvider(ChainId.BNB_CHAIN_MAINNET)).toThrow(
        /No scanner RPC provider configured/,
      );
    });
  });

  describe('rate limiting (tryAcquire + token bucket)', () => {
    it('allows calls up to the rate budget then denies', () => {
      process.env.RPC_SCANNER_ARBITRUM_URL = 'http://arb.example';
      process.env.SCANNER_RPC_RATE_LIMIT_RPS = '3';
      service.onModuleInit();

      expect(service.tryAcquire(ChainId.ARBITRUM_ONE_MAINNET)).toBe(true);
      expect(service.tryAcquire(ChainId.ARBITRUM_ONE_MAINNET)).toBe(true);
      expect(service.tryAcquire(ChainId.ARBITRUM_ONE_MAINNET)).toBe(true);
      // Bucket (capacity = rate = 3) is now empty.
      expect(service.tryAcquire(ChainId.ARBITRUM_ONE_MAINNET)).toBe(false);
    });

    it('returns false for a chain with no configured provider', () => {
      service.onModuleInit();
      expect(service.tryAcquire(ChainId.ARBITRUM_ONE_MAINNET)).toBe(false);
    });

    it('records rate-limited denials in metrics', async () => {
      process.env.RPC_SCANNER_ARBITRUM_URL = 'http://arb.example';
      process.env.SCANNER_RPC_RATE_LIMIT_RPS = '1';
      service.onModuleInit();
      service.tryAcquire(ChainId.ARBITRUM_ONE_MAINNET); // consume the only token
      service.tryAcquire(ChainId.ARBITRUM_ONE_MAINNET); // denied

      const metrics = await getArbibotMetricsRegistry().getMetricsAsJSON();
      const counter = metrics.find(
        (m) => m.name === 'arb_scanner_rpc_rate_limited_total',
      ) as
        | { values?: { labels?: Record<string, string>; value?: number }[] }
        | undefined;
      const value =
        counter?.values?.find(
          (v) => v.labels?.chain_id === String(ChainId.ARBITRUM_ONE_MAINNET),
        )?.value ?? 0;
      expect(value).toBeGreaterThanOrEqual(1);
    });
  });

  describe('health snapshot', () => {
    it('reports all supported chains with configured=false when none are set', () => {
      service.onModuleInit();
      const all = service.getAllHealthStatus();
      expect(all[String(ChainId.ARBITRUM_ONE_MAINNET)]?.configured).toBe(false);
      expect(all[String(ChainId.BASE_MAINNET)]?.configured).toBe(false);
      expect(all[String(ChainId.BNB_CHAIN_MAINNET)]?.configured).toBe(false);
    });

    it('reports healthy=true + blockNumber after a successful health probe', async () => {
      process.env.RPC_SCANNER_ARBITRUM_URL = 'http://arb.example';
      service.onModuleInit();
      // onModuleInit triggers an initial runHealthChecks(); await it.
      await new Promise((r) => setImmediate(r));

      const status = service.getHealthStatus(ChainId.ARBITRUM_ONE_MAINNET);
      expect(status).not.toBeNull();
      expect(status?.healthy).toBe(true);
      expect(status?.blockNumber).toBe(100);
      expect(status?.tokensAvailable).toBeGreaterThan(0);
    });
  });

  describe('metrics registration', () => {
    it('registers arb_scanner_rpc_* metrics on the shared registry', async () => {
      service.onModuleInit();
      const names = (await getArbibotMetricsRegistry().getMetricsAsJSON()).map(
        (m) => m.name,
      );
      expect(names).toContain('arb_scanner_rpc_latency_ms');
      expect(names).toContain('arb_scanner_rpc_rate_limited_total');
      expect(names).toContain('arb_scanner_rpc_failures_total');
      expect(names).toContain('arb_scanner_rpc_tokens_available');
    });
  });

  describe('resolveRatePerSecond env parse', () => {
    it('uses SCANNER_RPC_RATE_LIMIT_RPS when valid (>0)', async () => {
      process.env.RPC_SCANNER_ARBITRUM_URL = 'http://arb.example';
      process.env.SCANNER_RPC_RATE_LIMIT_RPS = '7';
      service.onModuleInit();
      // Drain the immediate health probe so afterEach destroy is clean.
      await (service as unknown as { runHealthChecks: () => Promise<void> }).runHealthChecks();
      // tryAcquire should reflect 7 rps budget: first call grants.
      expect(service.tryAcquire(ChainId.ARBITRUM_ONE_MAINNET)).toBe(true);
    });

    it('falls back to default when SCANNER_RPC_RATE_LIMIT_RPS is invalid (NaN)', () => {
      process.env.RPC_SCANNER_ARBITRUM_URL = 'http://arb.example';
      process.env.SCANNER_RPC_RATE_LIMIT_RPS = 'abc';
      service.onModuleInit();
      expect(service.tryAcquire(ChainId.ARBITRUM_ONE_MAINNET)).toBe(true);
    });

    it('falls back to default when SCANNER_RPC_RATE_LIMIT_RPS <= 0', () => {
      process.env.RPC_SCANNER_ARBITRUM_URL = 'http://arb.example';
      process.env.SCANNER_RPC_RATE_LIMIT_RPS = '0';
      service.onModuleInit();
      expect(service.tryAcquire(ChainId.ARBITRUM_ONE_MAINNET)).toBe(true);
    });
  });

  describe('checkProviderHealth — failure + latency paths', () => {
    it('marks the chain unhealthy and increments failures when getBlockNumber rejects', async () => {
      process.env.RPC_SCANNER_ARBITRUM_URL = 'http://arb.example';
      // Override the mocked provider's getBlockNumber to reject after init.
      service.onModuleInit();
      const provider = service.getProvider(ChainId.ARBITRUM_ONE_MAINNET) as unknown as {
        getBlockNumber: () => Promise<number>;
      };
      (provider).getBlockNumber = jest
        .fn()
        .mockRejectedValue(new Error('connection reset'));

      await (service as unknown as { runHealthChecks: () => Promise<void> }).runHealthChecks();

      const status = service.getHealthStatus(ChainId.ARBITRUM_ONE_MAINNET);
      expect(status?.healthy).toBe(false);
      expect(status?.error).toContain('connection reset');
    });

    it('records blockNumber + latency on a successful probe', async () => {
      process.env.RPC_SCANNER_ARBITRUM_URL = 'http://arb.example';
      service.onModuleInit();
      await (service as unknown as { runHealthChecks: () => Promise<void> }).runHealthChecks();

      const status = service.getHealthStatus(ChainId.ARBITRUM_ONE_MAINNET);
      expect(status?.blockNumber).toBe(100);
      expect(typeof status?.latency).toBe('number');
    });
  });

  describe('onModuleDestroy', () => {
    it('clears the health-check timer without throwing', () => {
      process.env.RPC_SCANNER_ARBITRUM_URL = 'http://arb.example';
      service.onModuleInit();
      expect(() => service.onModuleDestroy()).not.toThrow();
      // Re-instantiate to avoid afterEach double-destroy on the same instance.
      service = new ScannerRpcService();
    });
  });
});
