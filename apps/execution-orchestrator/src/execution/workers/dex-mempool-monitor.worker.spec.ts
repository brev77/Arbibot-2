import { Test } from '@nestjs/testing';
import { getArbibotMetricsRegistry } from '@arbibot/nest-platform';

import { DexMempoolMonitorWorker } from './dex-mempool-monitor.worker';
import { RpcProviderManager } from '../rpc/rpc-provider-manager.service';

// Clear metrics registry between tests
function clearRegistry() {
  try {
    getArbibotMetricsRegistry().clear();
  } catch {
    // Ignore if registry is not available
  }
}

describe('DexMempoolMonitorWorker', () => {
  let worker: DexMempoolMonitorWorker;
  let rpcManagerMock: Partial<RpcProviderManager>;

  beforeEach(() => {
    clearRegistry();

    rpcManagerMock = {
      getProvider: jest.fn(),
      getHealthStatus: jest.fn(),
    };

    // Disable monitoring by default (DEX_MEMPOOL_ENABLED not set)
    delete process.env.DEX_MEMPOOL_ENABLED;
    delete process.env.DEX_MEMPOOL_CHAIN_IDS;
    delete process.env.DEX_MEMPOOL_ROUTER_ADDRESSES;
    delete process.env.DEX_MEMPOOL_FRONTRUN_GAS_PREMIUM_BPS;
  });

  afterEach(() => {
    if (worker) {
      void worker.onModuleDestroy();
    }
  });

  async function createWorker(envOverrides: Record<string, string> = {}): Promise<DexMempoolMonitorWorker> {
    for (const [k, v] of Object.entries(envOverrides)) {
      process.env[k] = v;
    }

    const module = await Test.createTestingModule({
      providers: [
        DexMempoolMonitorWorker,
        { provide: RpcProviderManager, useValue: rpcManagerMock },
      ],
    }).compile();

    worker = module.get(DexMempoolMonitorWorker);
    return worker;
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  describe('lifecycle', () => {
    it('should not start monitoring when DEX_MEMPOOL_ENABLED is not set', async () => {
      const w = await createWorker();
      w.onModuleInit();
      expect(w.getConfig().enabled).toBe(false);
    });

    it('should load configuration from environment', async () => {
      const w = await createWorker({
        DEX_MEMPOOL_ENABLED: 'true',
        DEX_MEMPOOL_CHAIN_IDS: '42161,8453',
        DEX_MEMPOOL_FRONTRUN_GAS_PREMIUM_BPS: '300',
        DEX_MEMPOOL_MAX_PENDING: '100',
      });

      const config = w.getConfig();
      expect(config.enabled).toBe(true);
      expect(config.chainIds).toEqual([42161, 8453]);
      expect(config.frontrunGasPremiumBps).toBe(300);
      expect(config.maxPendingSwapsPerChain).toBe(100);
    });
  });

  // ---------------------------------------------------------------------------
  // checkMevRisk — no pending swaps
  // ---------------------------------------------------------------------------

  describe('checkMevRisk — empty mempool', () => {
    it('should return low risk when no pending swaps exist', async () => {
      const w = await createWorker();
      w.onModuleInit();

      const result = w.checkMevRisk({
        chainId: 42161,
        tokenIn: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        tokenOut: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
        ourGasPrice: 1_000_000_000n, // 1 gwei
      });

      expect(result.riskLevel).toBe('low');
      expect(result.threats).toHaveLength(0);
      expect(result.analyzedTxCount).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // checkMevRisk — frontrun detection
  // ---------------------------------------------------------------------------

  describe('checkMevRisk — frontrun detection', () => {
    it('should detect frontrun when pending tx has higher gas for same pair', async () => {
      const w = await createWorker({
        DEX_MEMPOOL_ENABLED: 'false',
        DEX_MEMPOOL_FRONTRUN_GAS_PREMIUM_BPS: '500',
      });
      w.onModuleInit();

      // Inject a pending swap manually via internal state
      const tokenIn = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';
      const tokenOut = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2';

      // Access internal pendingSwaps map for testing
      const pendingSwaps = (w as unknown as { pendingSwaps: Map<number, Array<{
        txHash: string;
        tokenIn: string;
        tokenOut: string;
        gasPrice: bigint;
        maxPriorityFeePerGas?: bigint;
        timestamp: number;
        from: string;
      }>> }).pendingSwaps;

      pendingSwaps.set(42161, [
        {
          txHash: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
          tokenIn,
          tokenOut,
          gasPrice: 2_000_000_000n, // 2 gwei — 100% more than our 1 gwei
          timestamp: Date.now(),
          from: '0xsuspiciousAddress',
        },
      ]);

      const result = w.checkMevRisk({
        chainId: 42161,
        tokenIn,
        tokenOut,
        ourGasPrice: 1_000_000_000n, // 1 gwei
      });

      expect(result.riskLevel).toBe('medium');
      expect(result.threats).toHaveLength(1);
      expect(result.threats[0]!.type).toBe('frontrun');
      expect(result.threats[0]!.gasPremiumBps).toBeGreaterThan(500);
      expect(result.analyzedTxCount).toBe(1);
    });

    it('should not detect frontrun when gas premium is below threshold', async () => {
      const w = await createWorker({
        DEX_MEMPOOL_ENABLED: 'false',
        DEX_MEMPOOL_FRONTRUN_GAS_PREMIUM_BPS: '500',
      });
      w.onModuleInit();

      const tokenIn = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';
      const tokenOut = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2';

      const pendingSwaps = (w as unknown as { pendingSwaps: Map<number, Array<{
        txHash: string; tokenIn: string; tokenOut: string; gasPrice: bigint;
        maxPriorityFeePerGas?: bigint; timestamp: number; from: string;
      }>> }).pendingSwaps;

      pendingSwaps.set(42161, [
        {
          txHash: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
          tokenIn,
          tokenOut,
          gasPrice: 1_010_000_000n, // Only 1% more (100 bps < 500 threshold)
          timestamp: Date.now(),
          from: '0xsuspiciousAddress',
        },
      ]);

      const result = w.checkMevRisk({
        chainId: 42161,
        tokenIn,
        tokenOut,
        ourGasPrice: 1_000_000_000n,
      });

      expect(result.riskLevel).toBe('low');
      expect(result.threats).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------------------
  // checkMevRisk — sandwich detection
  // ---------------------------------------------------------------------------

  describe('checkMevRisk — sandwich detection', () => {
    it('should detect sandwich when frontrun + reverse swap exist', async () => {
      const w = await createWorker({
        DEX_MEMPOOL_ENABLED: 'false',
        DEX_MEMPOOL_FRONTRUN_GAS_PREMIUM_BPS: '500',
      });
      w.onModuleInit();

      const tokenA = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';
      const tokenB = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2';

      const pendingSwaps = (w as unknown as { pendingSwaps: Map<number, Array<{
        txHash: string; tokenIn: string; tokenOut: string; gasPrice: bigint;
        maxPriorityFeePerGas?: bigint; timestamp: number; from: string;
      }>> }).pendingSwaps;

      const now = Date.now();
      pendingSwaps.set(42161, [
        // Frontrun: A→B with higher gas
        {
          txHash: '0xfront1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
          tokenIn: tokenA,
          tokenOut: tokenB,
          gasPrice: 2_000_000_000n, // 100% more
          timestamp: now - 1000,
          from: '0xattacker',
        },
        // Backrun: B→A (reverse) after frontrun
        {
          txHash: '0xback1234567890abcdef1234567890abcdef1234567890abcdef12345678901',
          tokenIn: tokenB,
          tokenOut: tokenA,
          gasPrice: 1_500_000_000n,
          timestamp: now, // after frontrun
          from: '0xattacker',
        },
      ]);

      const result = w.checkMevRisk({
        chainId: 42161,
        tokenIn: tokenA,
        tokenOut: tokenB,
        ourGasPrice: 1_000_000_000n,
      });

      // Should detect both frontrun and sandwich
      expect(result.riskLevel).toBe('high');
      const sandwichThreats = result.threats.filter((t) => t.type === 'sandwich');
      expect(sandwichThreats.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ---------------------------------------------------------------------------
  // checkMevRisk — backrun detection
  // ---------------------------------------------------------------------------

  describe('checkMevRisk — backrun detection', () => {
    it('should detect backrun when pending tx has significantly lower gas', async () => {
      const w = await createWorker({
        DEX_MEMPOOL_ENABLED: 'false',
      });
      w.onModuleInit();

      const tokenIn = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';
      const tokenOut = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2';

      const pendingSwaps = (w as unknown as { pendingSwaps: Map<number, Array<{
        txHash: string; tokenIn: string; tokenOut: string; gasPrice: bigint;
        maxPriorityFeePerGas?: bigint; timestamp: number; from: string;
      }>> }).pendingSwaps;

      pendingSwaps.set(42161, [
        {
          txHash: '0xback1234567890abcdef1234567890abcdef1234567890abcdef12345678901',
          tokenIn,
          tokenOut,
          gasPrice: 500_000_000n, // 50% less than our 1 gwei → -5000 bps
          timestamp: Date.now(),
          from: '0xsuspiciousAddress',
        },
      ]);

      const result = w.checkMevRisk({
        chainId: 42161,
        tokenIn,
        tokenOut,
        ourGasPrice: 1_000_000_000n,
      });

      const backrunThreats = result.threats.filter((t) => t.type === 'backrun');
      expect(backrunThreats.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ---------------------------------------------------------------------------
  // checkMevRisk — multiple threats → high risk
  // ---------------------------------------------------------------------------

  describe('checkMevRisk — risk level escalation', () => {
    it('should return high risk for sandwich', async () => {
      const w = await createWorker({ DEX_MEMPOOL_ENABLED: 'false' });
      w.onModuleInit();

      const tokenA = '0xaaaa';
      const tokenB = '0xbbbb';

      const pendingSwaps = (w as unknown as { pendingSwaps: Map<number, Array<{
        txHash: string; tokenIn: string; tokenOut: string; gasPrice: bigint;
        maxPriorityFeePerGas?: bigint; timestamp: number; from: string;
      }>> }).pendingSwaps;

      const now = Date.now();
      pendingSwaps.set(42161, [
        {
          txHash: '0xfront',
          tokenIn: tokenA, tokenOut: tokenB,
          gasPrice: 3_000_000_000n, timestamp: now - 2000, from: '0xa',
        },
        {
          txHash: '0xback',
          tokenIn: tokenB, tokenOut: tokenA,
          gasPrice: 1_000_000_000n, timestamp: now - 1000, from: '0xa',
        },
      ]);

      const result = w.checkMevRisk({
        chainId: 42161, tokenIn: tokenA, tokenOut: tokenB,
        ourGasPrice: 1_000_000_000n,
      });

      expect(result.riskLevel).toBe('high');
    });

    it('should return high risk for frontrun with multiple threats', async () => {
      const w = await createWorker({ DEX_MEMPOOL_ENABLED: 'false' });
      w.onModuleInit();

      const tokenA = '0xaaaa';
      const tokenB = '0xbbbb';

      const pendingSwaps = (w as unknown as { pendingSwaps: Map<number, Array<{
        txHash: string; tokenIn: string; tokenOut: string; gasPrice: bigint;
        maxPriorityFeePerGas?: bigint; timestamp: number; from: string;
      }>> }).pendingSwaps;

      pendingSwaps.set(42161, [
        {
          txHash: '0xfront1',
          tokenIn: tokenA, tokenOut: tokenB,
          gasPrice: 3_000_000_000n, timestamp: Date.now(), from: '0xa',
        },
        {
          txHash: '0xfront2',
          tokenIn: tokenA, tokenOut: tokenB,
          gasPrice: 2_500_000_000n, timestamp: Date.now(), from: '0xb',
        },
      ]);

      const result = w.checkMevRisk({
        chainId: 42161, tokenIn: tokenA, tokenOut: tokenB,
        ourGasPrice: 1_000_000_000n,
      });

      // 2 frontrun threats → high risk
      expect(result.riskLevel).toBe('high');
    });
  });

  // ---------------------------------------------------------------------------
  // checkMevRisk — different chain isolation
  // ---------------------------------------------------------------------------

  describe('checkMevRisk — chain isolation', () => {
    it('should only analyze swaps from the requested chain', async () => {
      const w = await createWorker({ DEX_MEMPOOL_ENABLED: 'false' });
      w.onModuleInit();

      const tokenA = '0xaaaa';
      const tokenB = '0xbbbb';

      const pendingSwaps = (w as unknown as { pendingSwaps: Map<number, Array<{
        txHash: string; tokenIn: string; tokenOut: string; gasPrice: bigint;
        maxPriorityFeePerGas?: bigint; timestamp: number; from: string;
      }>> }).pendingSwaps;

      // Suspicious swap on chain 8453
      pendingSwaps.set(8453, [
        {
          txHash: '0xsuspicious',
          tokenIn: tokenA, tokenOut: tokenB,
          gasPrice: 3_000_000_000n, timestamp: Date.now(), from: '0xattacker',
        },
      ]);

      // Empty on chain 42161
      pendingSwaps.set(42161, []);

      const result = w.checkMevRisk({
        chainId: 42161, tokenIn: tokenA, tokenOut: tokenB,
        ourGasPrice: 1_000_000_000n,
      });

      expect(result.riskLevel).toBe('low');
      expect(result.threats).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------------------
  // getPendingSwapCounts
  // ---------------------------------------------------------------------------

  describe('getPendingSwapCounts', () => {
    it('should return empty map when no swaps tracked', async () => {
      const w = await createWorker();
      w.onModuleInit();

      const counts = w.getPendingSwapCounts();
      expect(counts.size).toBe(0);
    });

    it('should return correct counts per chain', async () => {
      const w = await createWorker({ DEX_MEMPOOL_ENABLED: 'false' });
      w.onModuleInit();

      const pendingSwaps = (w as unknown as { pendingSwaps: Map<number, Array<{
        txHash: string; tokenIn: string; tokenOut: string; gasPrice: bigint;
        maxPriorityFeePerGas?: bigint; timestamp: number; from: string;
      }>> }).pendingSwaps;

      pendingSwaps.set(42161, [
        { txHash: '0x1', tokenIn: '0xa', tokenOut: '0xb', gasPrice: 1n, timestamp: Date.now(), from: '0x1' },
        { txHash: '0x2', tokenIn: '0xa', tokenOut: '0xb', gasPrice: 1n, timestamp: Date.now(), from: '0x1' },
      ]);
      pendingSwaps.set(8453, [
        { txHash: '0x3', tokenIn: '0xa', tokenOut: '0xb', gasPrice: 1n, timestamp: Date.now(), from: '0x1' },
      ]);

      const counts = w.getPendingSwapCounts();
      expect(counts.get(42161)).toBe(2);
      expect(counts.get(8453)).toBe(1);
    });
  });

  // ---------------------------------------------------------------------------
  // Gas premium calculation edge cases
  // ---------------------------------------------------------------------------

  describe('edge cases', () => {
    it('should handle zero ourGasPrice gracefully', async () => {
      const w = await createWorker({ DEX_MEMPOOL_ENABLED: 'false' });
      w.onModuleInit();

      const tokenA = '0xaaaa';
      const tokenB = '0xbbbb';

      const pendingSwaps = (w as unknown as { pendingSwaps: Map<number, Array<{
        txHash: string; tokenIn: string; tokenOut: string; gasPrice: bigint;
        maxPriorityFeePerGas?: bigint; timestamp: number; from: string;
      }>> }).pendingSwaps;

      pendingSwaps.set(42161, [
        {
          txHash: '0xsuspicious',
          tokenIn: tokenA, tokenOut: tokenB,
          gasPrice: 3_000_000_000n, timestamp: Date.now(), from: '0xattacker',
        },
      ]);

      // Zero gas price should not cause division error
      const result = w.checkMevRisk({
        chainId: 42161, tokenIn: tokenA, tokenOut: tokenB,
        ourGasPrice: 0n,
      });

      expect(result.riskLevel).toBe('low'); // gasPremiumBps returns 0 when ourGas is 0
    });

    it('should handle case-insensitive token addresses', async () => {
      const w = await createWorker({ DEX_MEMPOOL_ENABLED: 'false' });
      w.onModuleInit();

      const pendingSwaps = (w as unknown as { pendingSwaps: Map<number, Array<{
        txHash: string; tokenIn: string; tokenOut: string; gasPrice: bigint;
        maxPriorityFeePerGas?: bigint; timestamp: number; from: string;
      }>> }).pendingSwaps;

      pendingSwaps.set(42161, [
        {
          txHash: '0xfront',
          tokenIn: '0xAAAA', // uppercase
          tokenOut: '0xBBBB', // uppercase
          gasPrice: 3_000_000_000n,
          timestamp: Date.now(),
          from: '0xattacker',
        },
      ]);

      const result = w.checkMevRisk({
        chainId: 42161,
        tokenIn: '0xaaaa', // lowercase
        tokenOut: '0xbbbb', // lowercase
        ourGasPrice: 1_000_000_000n,
      });

      // Should match despite case difference
      expect(result.analyzedTxCount).toBe(1);
      expect(result.threats.some((t) => t.type === 'frontrun')).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // Cleanup
  // ---------------------------------------------------------------------------

  describe('cleanup', () => {
    it('should expire old entries beyond analysis window', async () => {
      const w = await createWorker({
        DEX_MEMPOOL_ENABLED: 'false',
        DEX_MEMPOOL_ANALYSIS_WINDOW_MS: '5000', // 5 second window
      });
      w.onModuleInit();

      const pendingSwaps = (w as unknown as { pendingSwaps: Map<number, Array<{
        txHash: string; tokenIn: string; tokenOut: string; gasPrice: bigint;
        maxPriorityFeePerGas?: bigint; timestamp: number; from: string;
      }>> }).pendingSwaps;

      const now = Date.now();
      pendingSwaps.set(42161, [
        { txHash: '0xold', tokenIn: '0xa', tokenOut: '0xb', gasPrice: 1n, timestamp: now - 10_000, from: '0x1' },
        { txHash: '0xnew', tokenIn: '0xa', tokenOut: '0xb', gasPrice: 1n, timestamp: now, from: '0x1' },
      ]);

      // Trigger cleanup
      (w as unknown as { cleanup: () => void }).cleanup();

      const swaps = pendingSwaps.get(42161)!;
      expect(swaps).toHaveLength(1);
      expect(swaps[0]!.txHash).toBe('0xnew');
    });
  });
});