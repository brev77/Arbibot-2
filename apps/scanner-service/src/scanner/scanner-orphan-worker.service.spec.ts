import { getArbibotMetricsRegistry } from '@arbibot/nest-platform';
import { ScannerFindingEntity } from '@arbibot/persistence';

import { ScannerOrphanWorkerService } from './scanner-orphan-worker.service';
import type { ScannerPublisherService } from './scanner-publisher.service';
import type { ScannerConfigService } from './scanner-config.service';

const makeFinding = (overrides: Partial<ScannerFindingEntity> = {}): ScannerFindingEntity =>
  ({
    id: 'f-1',
    instanceId: 'arb-2venue-1',
    opportunityId: null,
    publishStatus: 'pending',
    publishAttempts: 0,
    canonicalToken: '0xUSDC',
    chainId: 42161,
    buyVenue: 'uniswap-v2',
    sellVenue: 'sushiswap',
    buyPoolAddr: '0xBUY',
    sellPoolAddr: '0xSELL',
    spreadBps: 50,
    grossProfitUsd: '5.000000',
    netProfitUsd: '4.000000',
    feesUsd: '6.000000',
    volume1hUsd: null,
    volume24hUsd: null,
    observedAt: new Date(),
    ...overrides,
  });

describe('ScannerOrphanWorkerService', () => {
  const originalEnv = process.env;
  let findingsRepo: { find: jest.Mock };
  let publisher: { publish: jest.Mock };
  let config: { getConfig: jest.Mock };
  let worker: ScannerOrphanWorkerService;

  beforeEach(() => {
    getArbibotMetricsRegistry().clear();
    process.env = { ...originalEnv };
    findingsRepo = { find: jest.fn().mockResolvedValue([]) };
    publisher = { publish: jest.fn() };
    config = { getConfig: jest.fn().mockReturnValue({ defaults: { opportunityPublishTimeoutMs: 5000 } }) };
    worker = new ScannerOrphanWorkerService(
      findingsRepo as never,
      publisher as unknown as ScannerPublisherService,
      config as unknown as ScannerConfigService,
    );
  });

  afterEach(() => {
    worker.onModuleDestroy();
    process.env = originalEnv;
  });

  describe('runCycle — empty', () => {
    it('returns zero summary when no pending/failed findings', async () => {
      const result = await worker.runCycle();
      expect(result.scanned).toBe(0);
      expect(result.republished).toBe(0);
    });
  });

  describe('runCycle — republish', () => {
    it('re-publishes pending findings below the attempt cap', async () => {
      const finding = makeFinding({ publishStatus: 'pending', publishAttempts: 1 });
      findingsRepo.find.mockResolvedValue([finding]);
      publisher.publish.mockResolvedValue('opp-1');

      const result = await worker.runCycle();

      expect(result.scanned).toBe(1);
      expect(result.republished).toBe(1);
      expect(publisher.publish).toHaveBeenCalledTimes(1);
    });

    it('re-publishes failed findings below the cap', async () => {
      const finding = makeFinding({ publishStatus: 'failed', publishAttempts: 2 });
      findingsRepo.find.mockResolvedValue([finding]);
      publisher.publish.mockResolvedValue('opp-2');

      const result = await worker.runCycle();

      expect(result.republished).toBe(1);
    });

    it('skips findings at the attempt cap (exhausted, no republish)', async () => {
      const finding = makeFinding({ publishStatus: 'failed', publishAttempts: 5 });
      findingsRepo.find.mockResolvedValue([finding]);

      const result = await worker.runCycle();

      expect(result.exhausted).toBe(1);
      expect(result.republished).toBe(0);
      expect(publisher.publish).not.toHaveBeenCalled();
    });

    it('counts failed republish but keeps finding for next cycle', async () => {
      const finding = makeFinding({ publishStatus: 'pending', publishAttempts: 0 });
      findingsRepo.find.mockResolvedValue([finding]);
      publisher.publish.mockResolvedValue(null); // publish failed

      const result = await worker.runCycle();

      expect(result.republished).toBe(0);
      expect(result.exhausted).toBe(0); // not yet at cap
    });
  });

  describe('attempt cap override', () => {
    it('respects SCANNER_ORPHAN_MAX_ATTEMPTS env', async () => {
      process.env.SCANNER_ORPHAN_MAX_ATTEMPTS = '2';
      const finding = makeFinding({ publishStatus: 'failed', publishAttempts: 2 });
      findingsRepo.find.mockResolvedValue([finding]);

      const result = await worker.runCycle();

      expect(result.exhausted).toBe(1);
      expect(publisher.publish).not.toHaveBeenCalled();
    });
  });
});
