import { getArbibotMetricsRegistry } from '@arbibot/nest-platform';

import { ScannerPipelineService } from './scanner-pipeline.service';
import type { ScannerPoolService } from './scanner-pool.service';
import type { ScannerVolumeService } from './scanner-volume.service';
import type { ScannerSpreadService } from './scanner-spread.service';
import type { ScannerFilterService } from './scanner-filter.service';
import type { ScannerDedupService } from './scanner-dedup.service';
import type { PoolSnapshot } from './scanner-pool.service';
import type { CrossVenueSpread } from './scanner-spread.service';
import type { ScannerInstanceJson } from './scanner-config.types';

const makeInstance = (overrides: Partial<ScannerInstanceJson> = {}): ScannerInstanceJson => ({
  id: 'arb-2venue-1',
  name: 'Arbitrum 2-venue',
  network: 'arbitrum',
  strategy: '2venue',
  interval_ms: 2000,
  enabled: true,
  poolWhitelist: ['0xPOOL_A', '0xPOOL_B'],
  ...overrides,
});

const makePool = (overrides: Partial<PoolSnapshot> = {}): PoolSnapshot => ({
  chainId: 42161,
  poolAddress: '0xPOOL_A',
  venueKey: 'uniswap-v2',
  family: 'v2',
  token0: '0xWETH',
  token1: '0xUSDC',
  decimals0: 18,
  decimals1: 6,
  feeBps: 30,
  quotePerBase: 2000,
  liquidityUsd: null,
  reserve0: null,
  reserve1: null,
  blockNumber: null,
  readAt: Date.now(),
  ...overrides,
});

const makeSpread = (overrides: Partial<CrossVenueSpread> = {}): CrossVenueSpread => ({
  chainId: 42161,
  canonicalToken: '0xUSDC',
  token0: '0xWETH',
  token1: '0xUSDC',
  buyVenue: 'uniswap-v2',
  buyPoolAddress: '0xPOOL_A',
  buyPrice: 2000,
  sellVenue: 'sushiswap',
  sellPoolAddress: '0xPOOL_B',
  sellPrice: 2010,
  spreadBps: 50,
  feesUsd: 6,
  gasUsd: 0,
  grossProfitUsd: 5,
  netProfitUsd: 4,
  ...overrides,
});

describe('ScannerPipelineService', () => {
  let poolService: { readPool: jest.Mock };
  let volumeService: { readVolume: jest.Mock };
  let spreadService: { detect: jest.Mock };
  let filterService: { apply: jest.Mock };
  let dedupService: { shouldEmit: jest.Mock };
  let findingsRepo: { create: jest.Mock; save: jest.Mock };
  let service: ScannerPipelineService;

  beforeEach(() => {
    getArbibotMetricsRegistry().clear();
    poolService = { readPool: jest.fn() };
    volumeService = { readVolume: jest.fn().mockResolvedValue({ volumeUsd: null, strategy: 'none' }) };
    spreadService = { detect: jest.fn() };
    filterService = { apply: jest.fn().mockReturnValue({ passed: true, reason: null }) };
    dedupService = { shouldEmit: jest.fn().mockReturnValue(true) };
    findingsRepo = {
      create: jest.fn((x: unknown) => x),
      save: jest.fn().mockResolvedValue(undefined),
    };

    service = new ScannerPipelineService(
      poolService as unknown as ScannerPoolService,
      volumeService as unknown as ScannerVolumeService,
      spreadService as unknown as ScannerSpreadService,
      filterService as unknown as ScannerFilterService,
      dedupService as unknown as ScannerDedupService,
      findingsRepo as never,
    );
  });

  describe('runCycle — empty whitelist', () => {
    it('returns zero summary when poolWhitelist is empty', async () => {
      const result = await service.runCycle(makeInstance({ poolWhitelist: [] }));
      expect(result.poolsRead).toBe(0);
      expect(result.findingsWritten).toBe(0);
      expect(poolService.readPool).not.toHaveBeenCalled();
    });
  });

  describe('runCycle — full pipeline', () => {
    it('reads pools, detects spread, passes filter, writes finding', async () => {
      const pools = [
        makePool({ poolAddress: '0xPOOL_A', venueKey: 'uniswap-v2', quotePerBase: 2000 }),
        makePool({ poolAddress: '0xPOOL_B', venueKey: 'sushiswap', quotePerBase: 2010 }),
      ];
      poolService.readPool.mockImplementation((_chain, addr) =>
        Promise.resolve(pools.find((p) => p.poolAddress === addr) ?? null),
      );
      const spread = makeSpread();
      spreadService.detect.mockReturnValue(spread);

      const result = await service.runCycle(makeInstance());

      expect(result.poolsRead).toBe(2);
      expect(result.spreadsDetected).toBe(1);
      expect(result.findingsWritten).toBe(1);
      expect(findingsRepo.save).toHaveBeenCalledTimes(1);
      const saved = findingsRepo.save.mock.calls[0]?.[0] as { instanceId: string; publishStatus: string; spreadBps: number };
      expect(saved.instanceId).toBe('arb-2venue-1');
      expect(saved.publishStatus).toBe('pending');
      expect(saved.spreadBps).toBe(50);
    });

    it('skips when no spread detected (detect returns null)', async () => {
      poolService.readPool.mockResolvedValue(makePool());
      spreadService.detect.mockReturnValue(null);

      const result = await service.runCycle(makeInstance());

      expect(result.spreadsDetected).toBe(0);
      expect(findingsRepo.save).not.toHaveBeenCalled();
    });

    it('counts filtered-out spreads', async () => {
      poolService.readPool.mockResolvedValue(makePool());
      spreadService.detect.mockReturnValue(makeSpread());
      filterService.apply.mockReturnValue({ passed: false, reason: 'minSpreadBps' });

      const result = await service.runCycle(makeInstance());

      expect(result.findingsFiltered).toBe(1);
      expect(result.findingsWritten).toBe(0);
      expect(findingsRepo.save).not.toHaveBeenCalled();
    });

    it('skips when dedup suppresses', async () => {
      poolService.readPool.mockResolvedValue(makePool());
      spreadService.detect.mockReturnValue(makeSpread());
      dedupService.shouldEmit.mockReturnValue(false);

      const result = await service.runCycle(makeInstance());

      expect(result.findingsWritten).toBe(0);
      expect(findingsRepo.save).not.toHaveBeenCalled();
    });

    it('reads volume only when volumeRange.enabled=true', async () => {
      poolService.readPool.mockResolvedValue(makePool());
      spreadService.detect.mockReturnValue(makeSpread());

      // volumeRange disabled (default)
      await service.runCycle(makeInstance({ filters: { volumeRange: { enabled: false } } }));
      expect(volumeService.readVolume).not.toHaveBeenCalled();

      // volumeRange enabled
      await service.runCycle(makeInstance({ filters: { volumeRange: { enabled: true, min1hUsd: 1000 } } }));
      expect(volumeService.readVolume).toHaveBeenCalled();
    });
  });

  describe('runCycle — unknown network', () => {
    it('returns empty when network is unrecognized', async () => {
      const result = await service.runCycle(makeInstance({ network: 'unknown-chain' }));
      expect(result.poolsRead).toBe(0);
      expect(result.error).toBeNull();
    });
  });

  describe('runCycle — error handling', () => {
    it('gracefully handles individual pool read failures (returns empty, no crash)', async () => {
      // readPool rejects but the pipeline catches per-pool (.catch(() => null)) → empty result.
      poolService.readPool.mockRejectedValue(new Error('RPC down'));
      const result = await service.runCycle(makeInstance());
      expect(result.poolsRead).toBe(0);
      expect(result.error).toBeNull();
      expect(result.findingsWritten).toBe(0);
    });

    it('captures unexpected errors in the summary (non-fatal)', async () => {
      poolService.readPool.mockResolvedValue(makePool());
      spreadService.detect.mockImplementation(() => {
        throw new Error('spread crash');
      });
      const result = await service.runCycle(makeInstance());
      expect(result.error).toContain('spread crash');
    });
  });
});
