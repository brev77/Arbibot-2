import { getArbibotMetricsRegistry } from '@arbibot/nest-platform';

import { ScannerVolumeService } from './scanner-volume.service';
import type { PoolSnapshot } from './scanner-pool.service';
import type { ScannerRpcService } from './scanner-rpc.service';
import type { ScannerPoolService } from './scanner-pool.service';

/**
 * Mock ethers Contract: per-address method registry (same pattern as scanner-pool.service.spec).
 */
jest.mock('ethers', () => {
  const real = jest.requireActual('ethers');
  return {
    ...real,
    Contract: jest.fn((addr: string) => {
      const key = typeof addr === 'string' ? addr.toLowerCase() : '';
      const methods = (globalThis as { __volumeContracts?: Map<string, Record<string, jest.Mock>> }).__volumeContracts?.get(key);
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

const makeSnapshot = (overrides: Partial<PoolSnapshot> = {}): PoolSnapshot => ({
  chainId: 42161,
  poolAddress: '0xPOOL',
  venueKey: 'uniswap-v3',
  family: 'v3',
  token0: '0xWETH',
  token1: '0xUSDC',
  decimals0: 18,
  decimals1: 6,
  feeBps: 5,
  quotePerBase: 2000,
  liquidityUsd: null,
  reserve0: null,
  reserve1: null,
  blockNumber: null,
  readAt: Date.now(),
  ...overrides,
});

describe('ScannerVolumeService', () => {
  let rpc: { tryAcquire: jest.Mock; getProvider: jest.Mock };
  let poolService: { readPool: jest.Mock };
  let service: ScannerVolumeService;

  beforeEach(() => {
    getArbibotMetricsRegistry().clear();
    (globalThis as { __volumeContracts?: Map<string, unknown> }).__volumeContracts = new Map();
    rpc = {
      tryAcquire: jest.fn().mockReturnValue(true),
      getProvider: jest.fn().mockReturnValue({ getBlockNumber: jest.fn().mockResolvedValue(100_000) }),
    };
    poolService = { readPool: jest.fn() };
    service = new ScannerVolumeService(
      rpc as unknown as ScannerRpcService,
      poolService as unknown as ScannerPoolService,
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  function stageContract(address: string, methods: Record<string, jest.Mock>): void {
    const g = globalThis as { __volumeContracts?: Map<string, Record<string, jest.Mock>> };
    if (g.__volumeContracts === undefined) g.__volumeContracts = new Map();
    g.__volumeContracts.set(address.toLowerCase(), methods);
  }

  describe('readVolume — V3 cumulative', () => {
    it('seeds baseline on first read (volumeUsd null, strategy v3-cumulative)', async () => {
      stageContract('0xpool', {
        volumeToken0: jest.fn().mockResolvedValue(1_000_000n),
        volumeToken1: jest.fn().mockResolvedValue(2_000_000_000n),
      });
      const snap = makeSnapshot();

      const vol = await service.readVolume(snap);

      expect(vol.strategy).toBe('v3-cumulative');
      expect(vol.volumeUsd).toBeNull();
    });

    it('computes delta on second read (baseline diff)', async () => {
      stageContract('0xpool', {
        volumeToken0: jest.fn()
          .mockResolvedValueOnce(1_000_000n)
          .mockResolvedValueOnce(1_500_000n),
        volumeToken1: jest.fn()
          .mockResolvedValueOnce(2_000_000_000n)
          .mockResolvedValueOnce(2_500_000_000n),
      });
      const snap = makeSnapshot();

      await service.readVolume(snap); // seed baseline
      const vol = (await service.readVolume(snap));

      expect(vol.strategy).toBe('v3-cumulative');
      expect(vol.volumeUsd).not.toBeNull();
      expect(vol.volumeUsd).toBeGreaterThan(0);
    });

    it('handles wraparound (current < baseline → delta 0)', async () => {
      stageContract('0xpool', {
        volumeToken0: jest.fn()
          .mockResolvedValueOnce(1_000_000n)
          .mockResolvedValueOnce(500_000n), // decreased (wraparound)
        volumeToken1: jest.fn()
          .mockResolvedValueOnce(2_000_000_000n)
          .mockResolvedValueOnce(1_000_000_000n),
      });
      const snap = makeSnapshot();

      await service.readVolume(snap);
      const vol = await service.readVolume(snap);

      // Wraparound clamps delta to 0 → no negative volume.
      expect(vol.volumeUsd).not.toBeLessThan(0);
    });

    it('graceful revert when volumeToken reverts → strategy none', async () => {
      stageContract('0xpool', {
        volumeToken0: jest.fn().mockRejectedValue(new Error('execution reverted')),
        volumeToken1: jest.fn().mockRejectedValue(new Error('execution reverted')),
      });
      const snap = makeSnapshot();

      const vol = await service.readVolume(snap);

      expect(vol.strategy).toBe('none');
      expect(vol.volumeUsd).toBeNull();
    });

    it('returns none when rate-limited', async () => {
      rpc.tryAcquire.mockReturnValue(false);
      const snap = makeSnapshot();

      const vol = await service.readVolume(snap);

      expect(vol.strategy).toBe('none');
      expect(vol.volumeUsd).toBeNull();
    });
  });

  describe('readVolume — V2 logs', () => {
    it('sums Swap amount0In/amount1In over the bounded window', async () => {
      const swapLogs = [
        { args: [100n, 0n, 0n, 0n] }, // amount0In=100
        { args: [200n, 0n, 0n, 0n] }, // amount0In=200
        { args: [0n, 50n, 0n, 0n] }, // amount1In=50
      ];
      stageContract('0xpool', {
        queryFilter: jest.fn().mockResolvedValue(swapLogs),
      });
      const snap = makeSnapshot({ family: 'v2', venueKey: 'uniswap-v2', feeBps: 30 });

      const vol = (await service.readVolume(snap));

      expect(vol.strategy).toBe('v2-logs');
      expect(vol.volumeUsd).not.toBeNull();
      expect(vol.volumeUsd).toBeGreaterThan(0);
      expect(vol.blockRange).toBeDefined();
      expect(vol.blockRange?.toBlock).toBe(100_000);
    });

    it('returns none when getBlockNumber fails', async () => {
      rpc.getProvider.mockReturnValue({ getBlockNumber: jest.fn().mockResolvedValue(null) });
      const snap = makeSnapshot({ family: 'v2' });

      const vol = await service.readVolume(snap);

      expect(vol.strategy).toBe('none');
    });

    it('returns none when queryFilter throws', async () => {
      stageContract('0xpool', {
        queryFilter: jest.fn().mockRejectedValue(new Error('log range too large')),
      });
      const snap = makeSnapshot({ family: 'v2' });

      const vol = await service.readVolume(snap);

      expect(vol.strategy).toBe('none');
    });
  });

  describe('readVolume — unknown family', () => {
    it('returns none', async () => {
      const snap = makeSnapshot({ family: 'v3' as never });
      // Force unknown by patching family to a value that's neither v2 nor v3.
      (snap as { family: string }).family = 'unknown';
      const vol = await service.readVolume(snap);
      expect(vol.strategy).toBe('none');
    });
  });

  describe('readVolume — reader throws → noneResult (graceful degradation)', () => {
    it('V3 reader rejection → noneResult via .catch', async () => {
      const snap = makeSnapshot({ family: 'v3' });
      // No staged contract → Contract methods reject → readV3Cumulative throws → .catch → none.
      const vol = await service.readVolume(snap);
      expect(vol.strategy).toBe('none');
      expect(vol.volumeUsd).toBeNull();
    });

    it('V2 reader rejection → noneResult via .catch', async () => {
      const snap = makeSnapshot({ family: 'v2' });
      // rpc grants, but getBlockNumber rejects → readV2Logs throws → .catch → none.
      rpc.tryAcquire.mockReturnValue(true);
      rpc.getProvider.mockReturnValue({
        getBlockNumber: jest.fn().mockRejectedValue(new Error('rpc down')),
      });
      const vol = await service.readVolume(snap);
      expect(vol.strategy).toBe('none');
    });
  });

  describe('readVolume — V2 tryAcquire denied', () => {
    it('returns noneResult when the RPC rate budget denies', async () => {
      const snap = makeSnapshot({ family: 'v2' });
      rpc.tryAcquire.mockReturnValue(false);
      const vol = await service.readVolume(snap);
      expect(vol.strategy).toBe('none');
    });
  });

  describe('clearBaseline', () => {
    it('drops the V3 baseline so next read re-seeds', async () => {
      stageContract('0xpool', {
        volumeToken0: jest.fn()
          .mockResolvedValueOnce(1_000_000n)
          .mockResolvedValueOnce(1_000_000n)
          .mockResolvedValueOnce(2_000_000n),
        volumeToken1: jest.fn().mockResolvedValue(1_000_000_000n),
      });
      const snap = makeSnapshot();

      await service.readVolume(snap); // seed
      await service.readVolume(snap); // delta 0
      service.clearBaseline('0xPOOL');
      const vol = await service.readVolume(snap); // re-seed (volumeUsd null)
      expect(vol.volumeUsd).toBeNull();
    });
  });
});
