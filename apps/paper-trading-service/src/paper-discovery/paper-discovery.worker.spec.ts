import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { AuditClientService, getArbibotMetricsRegistry } from '@arbibot/nest-platform';
import {
  PaperDiscoveryCandidateEntity,
  PaperTradeEntity,
} from '@arbibot/persistence';

import { PaperDiscoveryService } from './paper-discovery.service';
import { PaperDiscoveryWorker } from './paper-discovery-worker';

class MockAuditClientService {
  appendEntry(): Promise<void> {
    return Promise.resolve();
  }
}

describe('PaperDiscoveryWorker', () => {
  let worker: PaperDiscoveryWorker;
  let discoveryService: PaperDiscoveryService;

  beforeEach(async () => {
    getArbibotMetricsRegistry().clear();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaperDiscoveryWorker,
        PaperDiscoveryService,
        {
          provide: getRepositoryToken(PaperDiscoveryCandidateEntity),
          useClass: Repository,
        },
        {
          provide: getRepositoryToken(PaperTradeEntity),
          useClass: Repository,
        },
        {
          provide: AuditClientService,
          useClass: MockAuditClientService,
        },
      ],
    }).compile();

    worker = module.get<PaperDiscoveryWorker>(PaperDiscoveryWorker);
    discoveryService = module.get<PaperDiscoveryService>(PaperDiscoveryService);
  });

  afterEach(() => {
    worker.onModuleDestroy();
    jest.clearAllMocks();
  });

  describe('onModuleInit', () => {
    it('should start worker when discovery is enabled', () => {
      process.env.PAPER_DISCOVERY_ENABLED = 'true';
      const spy = jest.spyOn(discoveryService, 'isEnabled').mockReturnValue(true);

      worker.onModuleInit();

      expect(spy).toHaveBeenCalled();
    });

    it('should not start worker when discovery is disabled', () => {
      process.env.PAPER_DISCOVERY_ENABLED = 'false';
      const spy = jest.spyOn(discoveryService, 'isEnabled').mockReturnValue(false);

      worker.onModuleInit();

      expect(spy).toHaveBeenCalled();
    });
  });

  describe('onModuleDestroy', () => {
    it('should set shutting down flag', () => {
      worker.onModuleDestroy();

      const status = worker.getStatus();
      expect(status.isShuttingDown).toBe(true);
    });
  });

  describe('getStatus', () => {
    it('should return worker status', () => {
      const status = worker.getStatus();

      expect(status).toBeDefined();
      expect(status.isRunning).toBe(false);
      expect(status.isShuttingDown).toBe(false);
      expect(status.config).toBeDefined();
    });
  });

  describe('triggerDiscovery', () => {
    it('should trigger discovery cycle when not running', async () => {
      jest
        .spyOn(
          worker,
          'runDiscoveryCycle',
        )
        .mockResolvedValue(undefined);

      const result = await worker.triggerDiscovery();

      expect(result.success).toBe(true);
      expect(result.message).toBe('Discovery cycle completed');
    });

    it('should return error when cycle already in progress', async () => {
      (worker as unknown as { isRunning: boolean }).isRunning = true;

      const result = await worker.triggerDiscovery();

      expect(result.success).toBe(false);
      expect(result.message).toBe('Discovery cycle already in progress');
    });

    it('should return error when cycle fails', async () => {
      const error = new Error('Test error');
      jest
        .spyOn(
          worker,
          'runDiscoveryCycle',
        )
        .mockRejectedValue(error);

      const result = await worker.triggerDiscovery();

      expect(result.success).toBe(false);
      expect(result.message).toContain('Discovery cycle failed');
    });
  });
});
