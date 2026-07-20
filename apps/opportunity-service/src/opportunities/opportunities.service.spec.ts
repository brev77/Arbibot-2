import { ConflictException, NotFoundException } from '@nestjs/common';
import { ArbitrageOpportunityEntity, OutboxEventEntity } from '@arbibot/persistence';
import type { DataSource, EntityManager } from 'typeorm';
import { QueryFailedError } from 'typeorm';

import { OpportunitiesService } from './opportunities.service';
import { OPPORTUNITY_STATES } from './opportunity-states';
import { PaperClientService } from './paper-client.service';
import { RiskClientService } from './risk-client.service';
import type { DexFiltersConfigDto } from './dto/preview-filters.dto';

/**
 * OpportunitiesService spec (Phase 4 — opportunity-service coverage).
 *
 * The service is the single-writer for ArbitrageOpportunity rows, plus
 * orchestrates risk evaluation + paper-enqueue. We exercise:
 *   - create / list / getById (thin repository wrappers)
 *   - enrich (transaction + state machine: NotFound / Conflict / happy /
 *     payloadPatch merge)
 *   - requestRiskEvaluation idempotent replay path (already risk_checked)
 *   - paperEnqueue (disabled / NotFound / dedup pending row / dedup unique
 *     violation / happy outbox insert)
 *   - previewFilters (filters.enabled=false → 0 filteredOut / enabled paths)
 *   - getMetrics (time-range count aggregation)
 *
 * EntityManager is stubbed with findOne/save; DataSource.transaction runs
 * the callback inline.
 */
describe('OpportunitiesService', () => {
  let repo: {
    create: jest.Mock;
    save: jest.Mock;
    find: jest.Mock;
    findOne: jest.Mock;
    count: jest.Mock;
  };
  let dataSource: { transaction: jest.Mock };
  let riskClient: { evaluateRisk: jest.Mock; correlationIdForOpportunity: jest.Mock };
  let paperClient: { isEnabled: jest.Mock; enqueuePromotionCandidate: jest.Mock };
  let service: OpportunitiesService;

  const mkEm = (
    overrides: Partial<{
      findOneRow: ArbitrageOpportunityEntity | null;
      pendingOutbox: OutboxEventEntity | null;
    }> = {},
  ): EntityManager => {
    const resolveOne = (
      Entity: object,
      opts?: { where?: { id?: string } },
    ): ArbitrageOpportunityEntity | OutboxEventEntity | null => {
      if (Entity === ArbitrageOpportunityEntity) {
        // Return null when an explicit id filter is supplied and does
        // not match the configured row.
        if (
          opts?.where?.id !== undefined &&
          overrides.findOneRow !== null &&
          overrides.findOneRow !== undefined &&
          opts.where.id !== overrides.findOneRow.id
        ) {
          return null;
        }
        return overrides.findOneRow ?? null;
      }
      if (Entity === OutboxEventEntity) {
        return overrides.pendingOutbox ?? null;
      }
      return null;
    };
    const em = {
      findOne: jest.fn(
        (Entity: object, opts?: { where?: { id?: string } }) =>
          Promise.resolve(resolveOne(Entity, opts)),
      ),
      save: jest.fn((entity, saved) => Promise.resolve(saved ?? entity)),
      create: jest.fn((_e, p) => p),
    };
    return em as unknown as EntityManager;
  };

  beforeEach(() => {
    repo = {
      create: jest.fn((p) => p),
      save: jest.fn((row) => Promise.resolve(row)),
      find: jest.fn(),
      findOne: jest.fn(),
      count: jest.fn(),
    };
    dataSource = {
      transaction: jest.fn((fn) => Promise.resolve(fn(mkEm()))),
    };
    riskClient = {
      evaluateRisk: jest.fn(),
      correlationIdForOpportunity: jest.fn(
        (s: string | null) => s ?? '00000000-0000-4000-8000-000000000001',
      ),
    };
    paperClient = {
      isEnabled: jest.fn().mockReturnValue(false),
      enqueuePromotionCandidate: jest.fn().mockResolvedValue(true),
    };
    service = new OpportunitiesService(
      repo as never,
      dataSource as unknown as DataSource,
      riskClient as unknown as RiskClientService,
      paperClient as unknown as PaperClientService,
    );
  });

  describe('create / list / getById', () => {
    it('create persists a detected-state row', async () => {
      const saved = { id: 'o1', state: OPPORTUNITY_STATES.detected };
      repo.save.mockResolvedValue(saved);
      const out = await service.create({ payload: { spread: 1 } });
      expect(repo.create.mock.calls[0]?.[0]).toMatchObject({
        state: OPPORTUNITY_STATES.detected,
        riskDecisionId: null,
        payload: { spread: 1 },
        entityVersion: 1,
      });
      expect(out).toBe(saved);
    });

    it('create defaults payload to {} when omitted', async () => {
      repo.save.mockResolvedValue({ id: 'o1' });
      await service.create({});
      expect(repo.create.mock.calls[0]?.[0].payload).toEqual({});
    });

    it('list forwards DESC createdAt take=100', async () => {
      repo.find.mockResolvedValue([]);
      await service.list();
      expect(repo.find.mock.calls[0]?.[0]).toMatchObject({
        order: { createdAt: 'DESC' },
        take: 100,
      });
    });

    it('getById forwards id to findOne', async () => {
      repo.findOne.mockResolvedValue(null);
      await service.getById('o1');
      expect(repo.findOne.mock.calls[0]?.[0]).toMatchObject({
        where: { id: 'o1' },
      });
    });
  });

  describe('enrich (state machine)', () => {
    const setRow = (row: Partial<ArbitrageOpportunityEntity> | null) => {
      dataSource.transaction.mockImplementation(
        (fn: (em: EntityManager) => Promise<unknown>) =>
          fn(mkEm({ findOneRow: row as unknown as ArbitrageOpportunityEntity | null })),
      );
    };

    it('throws NotFoundException when opportunity is missing', async () => {
      setRow(null);
      await expect(
        service.enrich('o1', { payloadPatch: { x: 1 } }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws ConflictException when state is not detected', async () => {
      setRow({
        id: 'o1',
        state: OPPORTUNITY_STATES.enriched,
        payload: {},
        entityVersion: 1,
      });
      await expect(
        service.enrich('o1', { payloadPatch: { x: 1 } }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('transitions detected → enriched with payload merge', async () => {
      const row = {
        id: 'o1',
        state: OPPORTUNITY_STATES.detected,
        payload: { existing: 'a' },
        entityVersion: 1,
      };
      setRow(row);
      const out = await service.enrich('o1', {
        payloadPatch: { new: 'b' },
      });
      expect((out).state).toBe(
        OPPORTUNITY_STATES.enriched,
      );
      // Payload merged.
      expect((out).payload).toMatchObject({
        existing: 'a',
        new: 'b',
      });
      expect((out).entityVersion).toBe(2);
    });

    it('omits payload merge when payloadPatch is undefined', async () => {
      const row = {
        id: 'o1',
        state: OPPORTUNITY_STATES.detected,
        payload: { existing: 'a' },
        entityVersion: 1,
      };
      setRow(row);
      const out = await service.enrich('o1', {});
      expect((out).payload).toEqual({
        existing: 'a',
      });
    });
  });

  describe('requestRiskEvaluation — idempotent replay', () => {
    it('returns idempotentReplay when opportunity is already risk_checked', async () => {
      repo.findOne.mockResolvedValue({
        id: 'o1',
        state: OPPORTUNITY_STATES.riskChecked,
        riskDecisionId: 'rd-1',
        correlationId: null,
      });
      const out = await service.requestRiskEvaluation('o1', {
        notionalUsd: 1000,
        snapshotVersion: 1,
      });
      expect(out.idempotentReplay).toBe(true);
      expect(out.riskDecisionId).toBe('rd-1');
      expect(out.riskOutcome).toBe('skipped');
    });

    it('throws ConflictException when risk_checked but riskDecisionId is null', async () => {
      repo.findOne.mockResolvedValue({
        id: 'o1',
        state: OPPORTUNITY_STATES.riskChecked,
        riskDecisionId: null,
      });
      await expect(
        service.requestRiskEvaluation('o1', {
          notionalUsd: 1000,
          snapshotVersion: 1,
        }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('throws NotFoundException when opportunity missing', async () => {
      repo.findOne.mockResolvedValue(null);
      await expect(
        service.requestRiskEvaluation('o1', {
          notionalUsd: 1000,
          snapshotVersion: 1,
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('paperEnqueue', () => {
    it('returns enqueued=false when paper client is disabled', async () => {
      paperClient.isEnabled.mockReturnValue(false);
      const out = await service.paperEnqueue('o1', {});
      expect(out).toEqual({ enqueued: false, paperServiceConfigured: false });
    });

    it('throws NotFoundException when opportunity missing (paper enabled)', async () => {
      paperClient.isEnabled.mockReturnValue(true);
      dataSource.transaction.mockImplementation(
        (fn: (em: EntityManager) => Promise<unknown>) => fn(mkEm({ findOneRow: null })),
      );
      await expect(service.paperEnqueue('o1', {})).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('deduplicates when a pending outbox row exists', async () => {
      paperClient.isEnabled.mockReturnValue(true);
      const row = {
        id: 'o1',
        state: OPPORTUNITY_STATES.riskChecked,
        payload: { instrumentKey: 'BTC' },
        correlationId: null,
      };
      dataSource.transaction.mockImplementation(
        (fn: (em: EntityManager) => Promise<unknown>) => fn(
            mkEm({
              findOneRow: row as unknown as ArbitrageOpportunityEntity,
              pendingOutbox: { id: 'ob1' } as OutboxEventEntity,
            }),
          ),
      );
      const out = await service.paperEnqueue('o1', {});
      expect(out).toEqual({
        enqueued: true,
        paperServiceConfigured: true,
        deduplicated: true,
      });
    });

    it('returns enqueued=true on happy path', async () => {
      paperClient.isEnabled.mockReturnValue(true);
      const row = {
        id: 'o1',
        state: OPPORTUNITY_STATES.riskChecked,
        payload: { instrumentKey: 'BTC' },
        correlationId: null,
      };
      dataSource.transaction.mockImplementation(
        (fn: (em: EntityManager) => Promise<unknown>) => fn(
            mkEm({
              findOneRow: row as unknown as ArbitrageOpportunityEntity,
              pendingOutbox: null,
            }),
          ),
      );
      const out = await service.paperEnqueue('o1', { score: 8 });
      expect(out).toEqual({ enqueued: true, paperServiceConfigured: true });
    });

    it('deduplicates on unique violation during outbox insert', async () => {
      paperClient.isEnabled.mockReturnValue(true);
      const row = {
        id: 'o1',
        state: OPPORTUNITY_STATES.riskChecked,
        payload: { instrumentKey: 'BTC' },
        correlationId: null,
      };
      const em = mkEm({
        findOneRow: row as unknown as ArbitrageOpportunityEntity,
        pendingOutbox: null,
      });
      // Replace save to throw unique violation on OutboxEventEntity.
      (em as unknown as { save: jest.Mock }).save = jest.fn().mockRejectedValue(
        new QueryFailedError(
          'INSERT',
          [],
          Object.assign(new Error('dup'), { code: '23505' }),
        ),
      );
      dataSource.transaction.mockImplementation(
        (fn: (em: EntityManager) => Promise<unknown>) => Promise.resolve( fn(em)),
      );
      const out = await service.paperEnqueue('o1', {});
      expect(out).toEqual({
        enqueued: true,
        paperServiceConfigured: true,
        deduplicated: true,
      });
    });

    it('rethrows non-unique-violation errors from outbox save', async () => {
      paperClient.isEnabled.mockReturnValue(true);
      const row = {
        id: 'o1',
        state: OPPORTUNITY_STATES.riskChecked,
        payload: { instrumentKey: 'BTC' },
        correlationId: null,
      };
      const em = mkEm({
        findOneRow: row as unknown as ArbitrageOpportunityEntity,
        pendingOutbox: null,
      });
      (em as unknown as { save: jest.Mock }).save = jest
        .fn()
        .mockRejectedValue(new Error('connection refused'));
      dataSource.transaction.mockImplementation(
        (fn: (em: EntityManager) => Promise<unknown>) => Promise.resolve( fn(em)),
      );
      await expect(service.paperEnqueue('o1', {})).rejects.toThrow(
        'connection refused',
      );
    });
  });

  describe('previewFilters', () => {
    const mkFilters = (
      overrides: Partial<{
        enabled: boolean;
        minSpreadValue: number;
      }> = {},
    ): DexFiltersConfigDto => ({
      enabled: overrides.enabled ?? false,
      filters: {
        minSpreadPct: {
          enabled: true,
          value: overrides.minSpreadValue ?? 0.5,
        },
        minProfitUsd: { enabled: false, value: 0 },
        maxFeesUsd: { enabled: false, value: 0 },
        volumeRange: { enabled: false, min: 0, max: 1000 },
        blacklistTokens: { enabled: false, tokens: [] },
        allowedChains: { enabled: false, chains: [] },
        quoteAssets: { enabled: false, assets: [] },
        highRisk: { enabled: false, maxRiskLevel: 'medium' },
      },
    });

    it('returns 0 filteredOut when filters.enabled=false', async () => {
      repo.find.mockResolvedValue([
        { payload: { spreadPct: 0.1 }, createdAt: new Date() },
        { payload: { spreadPct: 0.2 }, createdAt: new Date() },
      ]);
      const out = (await service.previewFilters(
        mkFilters({ enabled: false }),
      ));
      expect(out.totalOpportunities).toBe(2);
      expect(out.filteredOut).toBe(0);
      expect(out.filteredPercentage).toBe(0);
    });

    it('counts filtered rows when minSpreadPct threshold is enabled', async () => {
      repo.find.mockResolvedValue([
        { payload: { spreadPct: 0.1 }, createdAt: new Date() },
        { payload: { spreadPct: 0.6 }, createdAt: new Date() },
        { payload: {}, createdAt: new Date() },
      ]);
      const out = (await service.previewFilters(
        mkFilters({ enabled: true, minSpreadValue: 0.5 }),
      ));
      // Two rows fall below 0.5: spreadPct 0.1 and missing spreadPct (defaults 0).
      expect(out.filteredOut).toBe(2);
      expect(out.breakdown.minSpreadPct.count).toBe(2);
      expect(out.breakdown.minSpreadPct.percentage).toBeCloseTo(
        (2 / 3) * 100,
        1,
      );
    });

    it('returns 0 filteredOut when there are no opportunities', async () => {
      repo.find.mockResolvedValue([]);
      const out = (await service.previewFilters(
        mkFilters({ enabled: true }),
      ));
      expect(out.totalOpportunities).toBe(0);
      expect(out.filteredOut).toBe(0);
    });
  });

  describe('getMetrics', () => {
    it('aggregates counts across three time ranges', async () => {
      repo.count
        .mockResolvedValueOnce(10) // last1h
        .mockResolvedValueOnce(50) // last24h
        .mockResolvedValueOnce(200); // last7d
      const out = await service.getMetrics();
      expect(out.last1h.totalOpportunities).toBe(10);
      expect(out.last24h.totalOpportunities).toBe(50);
      expect(out.last7d.totalOpportunities).toBe(200);
      // passedFilters = total - sum(breakdown). breakdown uses Math.floor of
      // percentages of total. For 10 → breakdown sum = 0+0+0+0+0+0+0+0 = 0,
      // passedFilters = 10. For 50 → minSpread 1 + minProfit 2 + maxFees 1
      // + volume 2 + blacklist 0 + chains 0 + quote 1 + risk 0 = 7,
      // passedFilters = 43.
      expect(out.last1h.passedFilters).toBe(10);
      expect(out.last1h.rejectedByFilters).toBe(0);
      expect(out.last24h.passedFilters).toBe(50 - out.last24h.rejectedByFilters);
    });
  });

  // ───────────────────────────────────────────────────────────────────────
  // Additional coverage: requestRiskEvaluation happy path + state-machine
  // edge cases, previewFilters for every filter type.
  // ───────────────────────────────────────────────────────────────────────

  describe('requestRiskEvaluation — additional paths', () => {
    function setupTx(rows: Array<Partial<ArbitrageOpportunityEntity> | null>) {
      let callIdx = 0;
      dataSource.transaction.mockImplementation(
        (fn: (em: EntityManager) => Promise<unknown>) => {
          const row = rows[callIdx] ?? rows[rows.length - 1];
          callIdx++;
          return fn(mkEm({ findOneRow: row as unknown as ArbitrageOpportunityEntity }));
        },
      );
    }

    it('happy path: detected → enriched → riskChecked, returns idempotentReplay=false', async () => {
      // First repo.findOne (existing): detected
      repo.findOne
        .mockResolvedValueOnce({
          id: 'o1',
          state: OPPORTUNITY_STATES.detected,
          correlationId: null,
          riskDecisionId: null,
        })
        // afterPrepare: enriched (between two transactions)
        .mockResolvedValueOnce({
          id: 'o1',
          state: OPPORTUNITY_STATES.enriched,
          correlationId: null,
          riskDecisionId: null,
        });

      // Both transactions return the detected/enriched row
      setupTx([
        { id: 'o1', state: OPPORTUNITY_STATES.detected, correlationId: null },
        { id: 'o1', state: OPPORTUNITY_STATES.enriched, correlationId: null },
      ]);

      riskClient.evaluateRisk.mockResolvedValue({
        riskDecisionId: 'rd-happy',
        outcome: 'approved',
      });

      const out = await service.requestRiskEvaluation('o1', {
        notionalUsd: 1000,
        snapshotVersion: 1,
      });

      expect(out.idempotentReplay).toBe(false);
      expect(out.riskDecisionId).toBe('rd-happy');
      expect(out.riskOutcome).toBe('approved');
    });

    it('throws ConflictException when state after prepare is not enriched', async () => {
      repo.findOne
        .mockResolvedValueOnce({
          id: 'o1',
          state: OPPORTUNITY_STATES.detected,
          correlationId: null,
          riskDecisionId: null,
        })
        // afterPrepare: still detected (not enriched) → bypasses afterPrepare
        // idempotent skip and continues to commit-tx where state is invalid.
        .mockResolvedValueOnce({
          id: 'o1',
          state: OPPORTUNITY_STATES.detected,
          correlationId: null,
          riskDecisionId: null,
        });

      // First transaction returns detected → enriched transition.
      // Second (commit) transaction returns a row whose state is not enriched.
      setupTx([
        { id: 'o1', state: OPPORTUNITY_STATES.detected, correlationId: null },
        { id: 'o1', state: 'some_invalid_state', correlationId: null },
      ]);

      riskClient.evaluateRisk.mockResolvedValue({
        riskDecisionId: 'rd-1',
        outcome: 'approved',
      });

      await expect(
        service.requestRiskEvaluation('o1', { notionalUsd: 1, snapshotVersion: 1 }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('throws NotFoundException when prepare-tx finds nothing', async () => {
      repo.findOne.mockResolvedValueOnce({
        id: 'o1',
        state: OPPORTUNITY_STATES.detected,
        correlationId: null,
      });
      setupTx([null]);

      await expect(
        service.requestRiskEvaluation('o1', { notionalUsd: 1, snapshotVersion: 1 }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('returns idempotentReplay when afterPrepare is riskChecked', async () => {
      repo.findOne
        .mockResolvedValueOnce({
          id: 'o1',
          state: OPPORTUNITY_STATES.detected,
          correlationId: null,
        })
        .mockResolvedValueOnce({
          id: 'o1',
          state: OPPORTUNITY_STATES.riskChecked,
          riskDecisionId: 'rd-early',
        });

      // First tx returns detected → enriched transition
      setupTx([
        { id: 'o1', state: OPPORTUNITY_STATES.detected, correlationId: null },
      ]);

      const out = await service.requestRiskEvaluation('o1', {
        notionalUsd: 1,
        snapshotVersion: 1,
      });

      expect(out.idempotentReplay).toBe(true);
      expect(out.riskDecisionId).toBe('rd-early');
      expect(out.riskOutcome).toBe('skipped');
      expect(riskClient.evaluateRisk).not.toHaveBeenCalled();
    });

    it('throws ConflictException when commit-tx row is riskChecked with different decisionId', async () => {
      repo.findOne
        .mockResolvedValueOnce({
          id: 'o1',
          state: OPPORTUNITY_STATES.detected,
          correlationId: null,
        })
        .mockResolvedValueOnce({
          id: 'o1',
          state: OPPORTUNITY_STATES.enriched,
        });

      setupTx([
        { id: 'o1', state: OPPORTUNITY_STATES.detected, correlationId: null },
        { id: 'o1', state: OPPORTUNITY_STATES.riskChecked, riskDecisionId: 'rd-other' },
      ]);

      riskClient.evaluateRisk.mockResolvedValue({
        riskDecisionId: 'rd-current',
        outcome: 'approved',
      });

      await expect(
        service.requestRiskEvaluation('o1', { notionalUsd: 1, snapshotVersion: 1 }),
      ).rejects.toThrow(/different risk decision/);
    });

    it('throws ConflictException when commit-tx state is not enriched', async () => {
      repo.findOne
        .mockResolvedValueOnce({
          id: 'o1',
          state: OPPORTUNITY_STATES.detected,
          correlationId: null,
        })
        .mockResolvedValueOnce({
          id: 'o1',
          state: OPPORTUNITY_STATES.enriched,
        });

      setupTx([
        { id: 'o1', state: OPPORTUNITY_STATES.detected, correlationId: null },
        { id: 'o1', state: 'bogus_state' },
      ]);

      riskClient.evaluateRisk.mockResolvedValue({
        riskDecisionId: 'rd-1',
        outcome: 'approved',
      });

      await expect(
        service.requestRiskEvaluation('o1', { notionalUsd: 1, snapshotVersion: 1 }),
      ).rejects.toThrow(/Risk evaluation requires state enriched/);
    });

    it('throws NotFoundException when commit-tx finds nothing', async () => {
      repo.findOne
        .mockResolvedValueOnce({
          id: 'o1',
          state: OPPORTUNITY_STATES.detected,
          correlationId: null,
        })
        .mockResolvedValueOnce({
          id: 'o1',
          state: OPPORTUNITY_STATES.enriched,
        });

      setupTx([
        { id: 'o1', state: OPPORTUNITY_STATES.detected, correlationId: null },
        null,
      ]);

      riskClient.evaluateRisk.mockResolvedValue({
        riskDecisionId: 'rd-1',
        outcome: 'approved',
      });

      await expect(
        service.requestRiskEvaluation('o1', { notionalUsd: 1, snapshotVersion: 1 }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('returns idempotentReplay when commit-tx row matches riskDecisionId', async () => {
      repo.findOne
        .mockResolvedValueOnce({
          id: 'o1',
          state: OPPORTUNITY_STATES.detected,
          correlationId: null,
        })
        .mockResolvedValueOnce({
          id: 'o1',
          state: OPPORTUNITY_STATES.enriched,
        });

      setupTx([
        { id: 'o1', state: OPPORTUNITY_STATES.detected, correlationId: null },
        { id: 'o1', state: OPPORTUNITY_STATES.riskChecked, riskDecisionId: 'rd-match' },
      ]);

      riskClient.evaluateRisk.mockResolvedValue({
        riskDecisionId: 'rd-match',
        outcome: 'approved',
      });

      const out = await service.requestRiskEvaluation('o1', { notionalUsd: 1, snapshotVersion: 1 });
      expect(out.idempotentReplay).toBe(true);
    });

    it('uses dto.correlationId when provided', async () => {
      repo.findOne
        .mockResolvedValueOnce({
          id: 'o1',
          state: OPPORTUNITY_STATES.detected,
          correlationId: null,
        })
        .mockResolvedValueOnce({
          id: 'o1',
          state: OPPORTUNITY_STATES.enriched,
        });

      setupTx([
        { id: 'o1', state: OPPORTUNITY_STATES.detected, correlationId: null },
        { id: 'o1', state: OPPORTUNITY_STATES.enriched, correlationId: null },
      ]);

      riskClient.evaluateRisk.mockResolvedValue({
        riskDecisionId: 'rd-1',
        outcome: 'approved',
      });

      await service.requestRiskEvaluation('o1', {
        notionalUsd: 1,
        snapshotVersion: 1,
        correlationId: '00000000-0000-4000-8000-000000000099',
      });

      expect(riskClient.evaluateRisk).toHaveBeenCalledWith(
        expect.objectContaining({
          correlationId: '00000000-0000-4000-8000-000000000099',
        }),
        expect.anything(),
      );
    });
  });

  describe('previewFilters — every filter type', () => {
    const mkFiltersAll = (
      overrides: Partial<{
        minSpread: number;
        minProfit: number;
        maxFees: number;
        volMin: number;
        volMax: number;
        blacklist: string[];
        allowedChains: string[];
        quoteAssets: string[];
        maxRiskLevel: 'low' | 'medium' | 'high';
      }> = {},
    ): DexFiltersConfigDto => ({
      enabled: true,
      filters: {
        minSpreadPct: { enabled: true, value: overrides.minSpread ?? 0 },
        minProfitUsd: { enabled: true, value: overrides.minProfit ?? 0 },
        maxFeesUsd: { enabled: true, value: overrides.maxFees ?? 0 },
        volumeRange: {
          enabled: true,
          min: overrides.volMin ?? 0,
          max: overrides.volMax ?? Number.MAX_SAFE_INTEGER,
        },
        blacklistTokens: { enabled: true, tokens: overrides.blacklist ?? [] },
        allowedChains: { enabled: true, chains: overrides.allowedChains ?? [] },
        quoteAssets: { enabled: true, assets: overrides.quoteAssets ?? [] },
        highRisk: { enabled: true, maxRiskLevel: overrides.maxRiskLevel ?? 'high' },
      },
    });

    it('counts minProfitUsd filter', async () => {
      repo.find.mockResolvedValue([
        { payload: { profitUsd: 5 }, createdAt: new Date() },
        { payload: { profitUsd: 50 }, createdAt: new Date() },
      ]);
      const out = await service.previewFilters(
        mkFiltersAll({ minProfit: 10 }),
      );
      expect(out.breakdown.minProfitUsd.count).toBe(1);
    });

    it('counts maxFeesUsd filter (greater-than direction)', async () => {
      repo.find.mockResolvedValue([
        { payload: { feesUsd: 5 }, createdAt: new Date() },
        { payload: { feesUsd: 50 }, createdAt: new Date() },
      ]);
      const out = await service.previewFilters(
        mkFiltersAll({ maxFees: 10 }),
      );
      expect(out.breakdown.maxFeesUsd.count).toBe(1); // 50 > 10 → filtered
    });

    it('counts volumeRange filter (outside min-max)', async () => {
      repo.find.mockResolvedValue([
        { payload: { volumeUsd: 100 }, createdAt: new Date() }, // inside
        { payload: { volumeUsd: 5000 }, createdAt: new Date() }, // outside
        { payload: { volumeUsd: 1 }, createdAt: new Date() }, // below min
      ]);
      const out = await service.previewFilters(
        mkFiltersAll({ volMin: 50, volMax: 1000 }),
      );
      expect(out.breakdown.volumeRange.count).toBe(2);
    });

    it('counts blacklistTokens filter', async () => {
      repo.find.mockResolvedValue([
        { payload: { token: 'BTC' }, createdAt: new Date() },
        { payload: { token: 'ETH' }, createdAt: new Date() },
      ]);
      const out = await service.previewFilters(
        mkFiltersAll({ blacklist: ['BTC'] }),
      );
      expect(out.breakdown.blacklistTokens.count).toBe(1);
    });

    it('counts allowedChains filter (whitelist not-in)', async () => {
      repo.find.mockResolvedValue([
        { payload: { chain: 'arbitrum' }, createdAt: new Date() },
        { payload: { chain: 'optimism' }, createdAt: new Date() },
      ]);
      const out = await service.previewFilters(
        mkFiltersAll({ allowedChains: ['arbitrum'] }),
      );
      expect(out.breakdown.allowedChains.count).toBe(1); // optimism not in list
    });

    it('counts quoteAssets filter (whitelist not-in)', async () => {
      repo.find.mockResolvedValue([
        { payload: { quoteAsset: 'USDC' }, createdAt: new Date() },
        { payload: { quoteAsset: 'WETH' }, createdAt: new Date() },
      ]);
      const out = await service.previewFilters(
        mkFiltersAll({ quoteAssets: ['USDC'] }),
      );
      expect(out.breakdown.quoteAssets.count).toBe(1); // WETH not in list
    });

    it('counts highRisk filter (current level above max)', async () => {
      repo.find.mockResolvedValue([
        { payload: { riskLevel: 'low' }, createdAt: new Date() },
        { payload: { riskLevel: 'high' }, createdAt: new Date() },
      ]);
      const out = await service.previewFilters(
        mkFiltersAll({ maxRiskLevel: 'medium' }),
      );
      expect(out.breakdown.highRisk.count).toBe(1); // high > medium
    });

    it('multiple filters can flag the same row', async () => {
      repo.find.mockResolvedValue([
        {
          payload: {
            spreadPct: 0.1, // below minSpread 0.5
            profitUsd: 1, // below minProfit 10
            riskLevel: 'high', // above max medium
          },
          createdAt: new Date(),
        },
      ]);
      const out = await service.previewFilters(
        mkFiltersAll({ minSpread: 0.5, minProfit: 10, maxRiskLevel: 'medium' }),
      );
      expect(out.breakdown.minSpreadPct.count).toBe(1);
      expect(out.breakdown.minProfitUsd.count).toBe(1);
      expect(out.breakdown.highRisk.count).toBe(1);
      expect(out.filteredOut).toBe(1);
    });
  });
});
