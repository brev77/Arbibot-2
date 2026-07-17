import {
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';

import { OpportunitiesController } from './opportunities.controller';
import { OpportunitiesService } from './opportunities.service';
import { PaperDiscoveryService } from '../paper-discovery/paper-discovery.service';

/**
 * OpportunitiesController spec (Phase 4 — opportunity HTTP API coverage).
 *
 * The controller maps service entities to ISO-date response DTOs and gates
 * the manual paper-discovery run behind a token. Service + PaperDiscovery
 * are stubbed; controller-level concerns (ISO mapping, NotFound, token gate)
 * are the focus.
 */
describe('OpportunitiesController', () => {
  const originalEnv = process.env;
  let service: {
    create: jest.Mock;
    list: jest.Mock;
    getById: jest.Mock;
    enrich: jest.Mock;
    requestRiskEvaluation: jest.Mock;
    paperEnqueue: jest.Mock;
    previewFilters: jest.Mock;
    getMetrics: jest.Mock;
  };
  let paperDiscovery: { discoverPaperOpportunities: jest.Mock };
  let controller: OpportunitiesController;

  const UUID = '11111111-1111-4111-8111-111111111111';
  const createdAt = new Date('2026-07-17T10:00:00Z');
  const updatedAt = new Date('2026-07-17T11:00:00Z');

  /** Minimal opportunity entity the controller reads from. */
  const mkRow = (over: Record<string, unknown> = {}) => ({
    id: UUID,
    state: 'detected',
    correlationId: 'corr-1',
    riskDecisionId: null,
    payload: {},
    entityVersion: 1,
    createdAt,
    updatedAt,
    ...over,
  });

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.PAPER_DISCOVERY_RUN_TOKEN;
    service = {
      create: jest.fn(),
      list: jest.fn(),
      getById: jest.fn(),
      enrich: jest.fn(),
      requestRiskEvaluation: jest.fn(),
      paperEnqueue: jest.fn(),
      previewFilters: jest.fn(),
      getMetrics: jest.fn(),
    };
    paperDiscovery = { discoverPaperOpportunities: jest.fn() };
    controller = new OpportunitiesController(
      service as unknown as OpportunitiesService,
      paperDiscovery as unknown as PaperDiscoveryService,
    );
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe('create', () => {
    it('returns the created opportunity mapped to an ISO-date DTO', async () => {
      service.create.mockResolvedValue(mkRow());

      const result = await controller.create({});

      expect(result).toEqual({
        id: UUID,
        state: 'detected',
        correlationId: 'corr-1',
        riskDecisionId: null,
        entityVersion: 1,
        createdAt: createdAt.toISOString(),
      });
    });
  });

  describe('list', () => {
    it('maps each row to an ISO-date DTO', async () => {
      service.list.mockResolvedValue([mkRow(), mkRow({ id: '22222222-2222-4222-8222-222222222222' })]);

      const result = await controller.list();

      expect(result.items).toHaveLength(2);
      expect(result.items[0]).toMatchObject({
        id: UUID,
        createdAt: createdAt.toISOString(),
      });
    });

    it('returns an empty items array when no opportunities exist', async () => {
      service.list.mockResolvedValue([]);

      expect(await controller.list()).toEqual({ items: [] });
    });
  });

  describe('getOne', () => {
    it('returns the opportunity with payload + both timestamps', async () => {
      service.getById.mockResolvedValue(mkRow({ payload: { spread: 5 } }));

      const result = await controller.getOne(UUID);

      expect(result).toMatchObject({
        payload: { spread: 5 },
        createdAt: createdAt.toISOString(),
        updatedAt: updatedAt.toISOString(),
      });
    });

    it('throws NotFoundException when the service returns null', async () => {
      service.getById.mockResolvedValue(null);

      await expect(controller.getOne(UUID)).rejects.toThrow(NotFoundException);
    });
  });

  describe('enrich', () => {
    it('enriches and returns the ISO-date DTO with payload', async () => {
      service.enrich.mockResolvedValue(mkRow({ state: 'enriched', payload: { spread: 5 } }));

      const result = await controller.enrich(UUID, { spread: 5 } as never);

      expect(service.enrich).toHaveBeenCalledWith(UUID, { spread: 5 });
      expect(result.state).toBe('enriched');
      expect(result.updatedAt).toBe(updatedAt.toISOString());
    });
  });

  describe('requestRiskEvaluation', () => {
    it('returns the risk outcome + opportunity state in an ISO-date DTO', async () => {
      service.requestRiskEvaluation.mockResolvedValue({
        opportunity: mkRow({ state: 'risk_checked', entityVersion: 2 }),
        riskDecisionId: 'rd-1',
        riskOutcome: 'approved',
        idempotentReplay: false,
      });

      const result = await controller.requestRiskEvaluation(UUID, {} as never);

      expect(result).toEqual({
        opportunityId: UUID,
        state: 'risk_checked',
        correlationId: 'corr-1',
        riskDecisionId: 'rd-1',
        riskOutcome: 'approved',
        idempotentReplay: false,
        entityVersion: 2,
        updatedAt: updatedAt.toISOString(),
      });
    });
  });

  describe('paperEnqueue', () => {
    it('delegates to service.paperEnqueue and returns its result', async () => {
      service.paperEnqueue.mockResolvedValue({ enqueued: true });

      const result = await controller.paperEnqueue(UUID, { operatorId: 'op-1' } as never);

      expect(service.paperEnqueue).toHaveBeenCalledWith(UUID, { operatorId: 'op-1' });
      expect(result).toEqual({ enqueued: true });
    });
  });

  describe('runPaperDiscovery (token gate)', () => {
    it('throws NotFoundException when PAPER_DISCOVERY_RUN_TOKEN is unset', async () => {
      await expect(controller.runPaperDiscovery(undefined)).rejects.toThrow(
        NotFoundException,
      );
      expect(paperDiscovery.discoverPaperOpportunities).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when the token is whitespace-only', async () => {
      process.env.PAPER_DISCOVERY_RUN_TOKEN = '   ';

      await expect(controller.runPaperDiscovery('x')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws UnauthorizedException when the header token does not match', async () => {
      process.env.PAPER_DISCOVERY_RUN_TOKEN = 'secret';

      await expect(controller.runPaperDiscovery('wrong')).rejects.toThrow(
        UnauthorizedException,
      );
      expect(paperDiscovery.discoverPaperOpportunities).not.toHaveBeenCalled();
    });

    it('runs discovery and returns its result when the token matches', async () => {
      process.env.PAPER_DISCOVERY_RUN_TOKEN = 'secret';
      paperDiscovery.discoverPaperOpportunities.mockResolvedValue({ discovered: 3 });

      const result = await controller.runPaperDiscovery('secret');

      expect(result).toEqual({ discovered: 3 });
      expect(paperDiscovery.discoverPaperOpportunities).toHaveBeenCalledTimes(1);
    });
  });

  describe('previewFilters / getDexFiltersMetrics', () => {
    it('previewFilters delegates to the service', async () => {
      const preview = { matched: 10, total: 100 };
      service.previewFilters.mockResolvedValue(preview);

      const result = await controller.previewFilters({} as never);

      expect(result).toBe(preview);
    });

    it('getDexFiltersMetrics delegates to service.getMetrics', async () => {
      const metrics = { last1h: { applied: 5 }, last24h: {}, last7d: {} };
      service.getMetrics.mockResolvedValue(metrics);

      const result = await controller.getDexFiltersMetrics();

      expect(result).toBe(metrics);
    });
  });
});
