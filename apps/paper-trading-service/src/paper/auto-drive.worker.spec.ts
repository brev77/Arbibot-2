import { getArbibotMetricsRegistry } from '@arbibot/nest-platform';
import {
  PaperPromotionCandidateEntity,
  PaperTradeEntity,
} from '@arbibot/persistence';
import { Repository } from 'typeorm';

import { AutoDriveConfigService, type AutoDriveConfig } from './auto-drive-config.service';
import { AutoDriveWorker } from './auto-drive.worker';
import { PaperPromotionService } from './paper-promotion.service';
import { PaperTradesService } from './paper-trades.service';

/**
 * Reset the singleton prometheus registry between tests so IIFE-declared metrics
 * don't trip "metric already registered" on the second worker construction.
 * (Mirror of paper-discovery-worker.spec.ts pattern.)
 */
function clearMetrics(): void {
  try {
    getArbibotMetricsRegistry().clear();
  } catch {
    /* ignore — registry may already be empty */
  }
}

function mkConfig(overrides: Partial<AutoDriveConfig> = {}): AutoDriveConfig {
  return {
    enabled: true,
    intervalMs: 60000,
    minNetProfitUsd: 5,
    maxConcurrentTrades: 20,
    notionalUsd: 1000,
    batchSize: 10,
    autoApprove: false,
    autoPromote: false,
    autoSettleDelayMs: 5000,
    ...overrides,
  };
}

function mkConfigService(cfg: AutoDriveConfig): AutoDriveConfigService {
  const svc = {
    getConfig: jest.fn().mockReturnValue(cfg),
    isEnabled: jest.fn().mockReturnValue(cfg.enabled),
    ensureEffectiveConfigLoaded: jest.fn().mockResolvedValue(undefined),
  } as unknown as AutoDriveConfigService;
  return svc;
}

function mkTradesService(): {
  svc: PaperTradesService;
  create: jest.Mock;
  approve: jest.Mock;
  settle: jest.Mock;
} {
  // Mock implementations are async to satisfy PaperTradesService signatures; they resolve
  // synchronously without await, hence the per-line eslint disables.
  // eslint-disable-next-line @typescript-eslint/require-await
  const create = jest.fn().mockImplementation(async (dto: { idempotencyKey?: string }) => ({
    id: 'trade-' + (dto.idempotencyKey ?? 'x'),
    state: 'draft',
    idempotencyKey: dto.idempotencyKey ?? null,
  }));
  // eslint-disable-next-line @typescript-eslint/require-await
  const approve = jest.fn().mockImplementation(async (id: string) => ({
    id,
    state: 'active',
  }));
  const settle = jest.fn().mockImplementation(
    // eslint-disable-next-line @typescript-eslint/require-await
    async (id: string, dto: { profitUsd: number }) => ({
      id,
      state: 'settled',
      profitUsd: String(dto.profitUsd),
    }),
  );
  const svc = { create, approve, settle } as unknown as PaperTradesService;
  return { svc, create, approve, settle };
}

/**
 * Mock PaperPromotionService for Phase 0 tests. autoPromote returns a configurable outcome;
 * tests assert on the `autoPromote` mock to verify the worker delegates correctly.
 */
function mkPromotionService(
  outcome: 'promoted' | 'rejected' | 'skipped' = 'promoted',
): { svc: PaperPromotionService; autoPromote: jest.Mock } {
  const autoPromote = jest.fn().mockResolvedValue({
    row: { id: 'cand', status: outcome === 'promoted' ? 'promoted' : outcome === 'rejected' ? 'rejected' : 'queued' },
    outcome,
  });
  const svc = { autoPromote } as unknown as PaperPromotionService;
  return { svc, autoPromote };
}

function mkCandidate(overrides: Partial<PaperPromotionCandidateEntity> = {}): PaperPromotionCandidateEntity {
  return {
    id: 'cand-1',
    instrumentKey: 'BTC-USDT',
    opportunityId: 'opp-1',
    source: 'opportunity_hook',
    status: 'promoted',
    score: null,
    driftBps: null,
    evidence: { netProfitUsd: 50, spreadBps: 42, buyVenue: 'uni', sellVenue: 'sushi', buyPrice: 100, sellPrice: 101 },
    entityVersion: 1,
    qualityScore: null,
    qualityTier: null,
    enqueueIdempotencyKey: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function mkTrade(overrides: Partial<PaperTradeEntity> = {}): PaperTradeEntity {
  return {
    id: 'trade-1',
    opportunityId: 'opp-1',
    instrumentKey: 'BTC-USDT',
    routeKey: null,
    state: 'active',
    notional: '1000',
    summary: { netProfitUsd: 50, spreadBps: 42, buyPrice: 100, sellPrice: 101 },
    entryPrice: null,
    exitPrice: null,
    profitUsd: null,
    settledAt: null,
    entityVersion: 1,
    idempotencyKey: null,
    createdAt: new Date(),
    updatedAt: new Date(Date.now() - 60_000), // 60s ago — past settle delay
    ...overrides,
  };
}

/**
 * Mock tradesRepo. Defaults: no existing draft, no drafts/actives to process, 0 active count.
 * Each test overrides via opts to exercise a specific phase.
 */
function mkTradesRepo(opts: {
  existingDraft?: PaperTradeEntity | null;
  drafts?: PaperTradeEntity[];
  actives?: PaperTradeEntity[];
  activeCount?: number;
} = {}): Repository<PaperTradeEntity> {
  return {
    findOne: jest.fn().mockResolvedValue(opts.existingDraft === undefined ? null : opts.existingDraft),
    find: jest.fn().mockImplementation(
      // eslint-disable-next-line @typescript-eslint/require-await
      async (args: { where?: { state?: unknown } }) => {
        const state = (args.where as { state?: string } | undefined)?.state;
        if (state === 'draft') return opts.drafts ?? [];
        if (state === 'active') return opts.actives ?? [];
        return [];
      },
    ),
    count: jest.fn().mockResolvedValue(opts.activeCount ?? 0),
  } as unknown as Repository<PaperTradeEntity>;
}

describe('AutoDriveWorker', () => {
  beforeEach(() => {
    clearMetrics();
    // AutoDriveWorker reads intervalMs at onModuleInit; ensure deterministic value.
    process.env.PAPER_AUTO_DRIVE_INTERVAL_MS = '60000';
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('phase A creates draft from promoted candidate (happy path)', async () => {
    const trades = mkTradesService();
    const promotion = mkPromotionService();
    const candidatesRepo = {
      find: jest.fn().mockResolvedValue([mkCandidate()]),
    } as never;
    const tradesRepo = mkTradesRepo();
    const worker = new AutoDriveWorker(
      mkConfigService(mkConfig()),
      trades.svc,
      promotion.svc,
      candidatesRepo,
      tradesRepo,
    );
    const summary = await worker.trigger();
    expect(summary.ran).toBe(true);
    expect(summary.draftsCreated).toBe(1);
    expect(trades.create).toHaveBeenCalledTimes(1);
    const call = trades.create.mock.calls[0]?.[0] as { idempotencyKey: string; summary: Record<string, unknown> };
    expect(call.idempotencyKey).toBe('auto-drive:cand-1');
    expect(call.summary).toMatchObject({ netProfitUsd: 50, buyPrice: 100, sellPrice: 101 });
  });

  it('phase A is idempotent — skips when draft already exists', async () => {
    const trades = mkTradesService();
    const candidatesRepo = {
      find: jest.fn().mockResolvedValue([mkCandidate()]),
    } as never;
    const tradesRepo = mkTradesRepo({ existingDraft: { id: 'existing-trade' } as PaperTradeEntity });
    const worker = new AutoDriveWorker(
      mkConfigService(mkConfig()),
      trades.svc,
      mkPromotionService().svc,
      candidatesRepo,
      tradesRepo,
    );
    const summary = await worker.trigger();
    expect(summary.draftsCreated).toBe(0);
    expect(trades.create).not.toHaveBeenCalled();
  });

  it('phase A filters candidates below minNetProfitUsd', async () => {
    const trades = mkTradesService();
    const candidate = mkCandidate({
      evidence: { netProfitUsd: 1 }, // below default minNetProfitUsd=5
    });
    const candidatesRepo = { find: jest.fn().mockResolvedValue([candidate]) } as never;
    const tradesRepo = mkTradesRepo();
    const worker = new AutoDriveWorker(
      mkConfigService(mkConfig({ minNetProfitUsd: 5 })),
      trades.svc,
      mkPromotionService().svc,
      candidatesRepo,
      tradesRepo,
    );
    const summary = await worker.trigger();
    expect(summary.draftsCreated).toBe(0);
    expect(trades.create).not.toHaveBeenCalled();
  });

  it('phase B skipped when autoApprove=false (default)', async () => {
    const trades = mkTradesService();
    const candidatesRepo = { find: jest.fn().mockResolvedValue([]) } as never;
    const tradesRepo = mkTradesRepo({ drafts: [mkTrade({ state: 'draft' })] });
    const worker = new AutoDriveWorker(
      mkConfigService(mkConfig({ autoApprove: false })),
      trades.svc,
      mkPromotionService().svc,
      candidatesRepo,
      tradesRepo,
    );
    const summary = await worker.trigger();
    expect(summary.approved).toBe(0);
    expect(trades.approve).not.toHaveBeenCalled();
  });

  it('phase B respects maxConcurrentTrades gate', async () => {
    const trades = mkTradesService();
    const candidatesRepo = { find: jest.fn().mockResolvedValue([]) } as never;
    const tradesRepo = mkTradesRepo({
      drafts: [mkTrade({ state: 'draft' })],
      activeCount: 20,
    });
    const worker = new AutoDriveWorker(
      mkConfigService(mkConfig({ autoApprove: true, maxConcurrentTrades: 20 })),
      trades.svc,
      mkPromotionService().svc,
      candidatesRepo,
      tradesRepo,
    );
    const summary = await worker.trigger();
    expect(summary.approved).toBe(0);
    expect(trades.approve).not.toHaveBeenCalled();
  });

  it('phase B approves drafts when autoApprove=true and headroom exists', async () => {
    const trades = mkTradesService();
    const candidatesRepo = { find: jest.fn().mockResolvedValue([]) } as never;
    const tradesRepo = mkTradesRepo({ drafts: [mkTrade({ id: 'd1', state: 'draft' })] });
    const worker = new AutoDriveWorker(
      mkConfigService(mkConfig({ autoApprove: true, maxConcurrentTrades: 20 })),
      trades.svc,
      mkPromotionService().svc,
      candidatesRepo,
      tradesRepo,
    );
    const summary = await worker.trigger();
    expect(summary.approved).toBe(1);
    expect(trades.approve).toHaveBeenCalledWith('d1', 'auto-driver');
  });

  it('phase C settles aged active trade with P/L from summary', async () => {
    const trades = mkTradesService();
    const candidatesRepo = { find: jest.fn().mockResolvedValue([]) } as never;
    const tradesRepo = mkTradesRepo({ actives: [mkTrade({ id: 'a1', state: 'active' })] });
    const worker = new AutoDriveWorker(
      mkConfigService(mkConfig({ autoSettleDelayMs: 1000 })),
      trades.svc,
      mkPromotionService().svc,
      candidatesRepo,
      tradesRepo,
    );
    const summary = await worker.trigger();
    expect(summary.settled).toBe(1);
    expect(trades.settle).toHaveBeenCalledWith(
      'a1',
      expect.objectContaining({ entryPrice: 100, exitPrice: 101, profitUsd: 50, spreadBps: 42, expectedVersion: 1 }),
      'auto-driver',
    );
  });

  it('phase C skips trade younger than autoSettleDelayMs', async () => {
    const trades = mkTradesService();
    const young = mkTrade({ updatedAt: new Date() }); // ageMs ≈ 0
    const candidatesRepo = { find: jest.fn().mockResolvedValue([]) } as never;
    const tradesRepo = mkTradesRepo({ actives: [young] });
    const worker = new AutoDriveWorker(
      mkConfigService(mkConfig({ autoSettleDelayMs: 60_000 })),
      trades.svc,
      mkPromotionService().svc,
      candidatesRepo,
      tradesRepo,
    );
    const summary = await worker.trigger();
    expect(summary.settled).toBe(0);
    expect(trades.settle).not.toHaveBeenCalled();
  });

  it('phase C handles already-settled idempotently without counting', async () => {
    // Phase C queries active trades only — but to exercise the idempotent-count guard we feed a
    // row whose state was already 'settled'. settle() returns the settled row, and because the
    // input trade.state === 'settled' (not !== 'settled'), the count must stay at 0.
    const trades = mkTradesService();
    trades.settle.mockResolvedValueOnce({ id: 'a1', state: 'settled' });
    const alreadySettled = mkTrade({ id: 'a1', state: 'settled' });
    const candidatesRepo = { find: jest.fn().mockResolvedValue([]) } as never;
    const tradesRepo = mkTradesRepo({ actives: [alreadySettled] });
    const worker = new AutoDriveWorker(
      mkConfigService(mkConfig()),
      trades.svc,
      mkPromotionService().svc,
      candidatesRepo,
      tradesRepo,
    );
    const summary = await worker.trigger();
    expect(summary.settled).toBe(0);
  });

  it('phase A failure does not crash the tick (error isolated per candidate)', async () => {
    const trades = mkTradesService();
    trades.create
      .mockRejectedValueOnce(new Error('db down'))
      .mockResolvedValueOnce({ id: 't2', state: 'draft' });
    const c1 = mkCandidate({ id: 'c1' });
    const c2 = mkCandidate({ id: 'c2' });
    const candidatesRepo = { find: jest.fn().mockResolvedValue([c1, c2]) } as never;
    const tradesRepo = mkTradesRepo();
    const worker = new AutoDriveWorker(
      mkConfigService(mkConfig()),
      trades.svc,
      mkPromotionService().svc,
      candidatesRepo,
      tradesRepo,
    );
    const summary = await worker.trigger();
    expect(summary.draftsCreated).toBe(1); // c1 failed, c2 succeeded
    expect(trades.create).toHaveBeenCalledTimes(2);
  });

  // --- Phase 0 (auto-promote) — delegates to PaperPromotionService.autoPromote ---
  // Previously Phase 0 wrote directly to candidatesRepo with no CAS lock, no eligibility gate,
  // and no audit. These tests pin the delegation contract: the worker calls the service and
  // maps its outcome to metrics, without touching the candidate repo itself for promotions.

  /**
   * Build a candidatesRepo mock that returns different rows depending on the queried status,
   * so Phase -1 (queued+under_review), Phase 0 (queued) and Phase A (promoted) see distinct sets.
   */
  function mkCandidatesRepoByStatus(opts: {
    queued?: PaperPromotionCandidateEntity[];
    promoted?: PaperPromotionCandidateEntity[];
  } = {}): Repository<PaperPromotionCandidateEntity> {
    return {
      find: jest.fn().mockImplementation(
        // eslint-disable-next-line @typescript-eslint/require-await
        async (args: { where?: { status?: unknown } }) => {
          const status = args.where?.status;
          // Phase -1 queries In(['queued','under_review']) → treat as the queued set (TypeORM In
          // object — no exact candidates here, so an empty array keeps Phase -1 a no-op).
          if (status !== undefined && typeof status === 'object') {
            return [];
          }
          if (status === 'queued') return opts.queued ?? [];
          if (status === 'promoted') return opts.promoted ?? [];
          return [];
        },
      ),
      save: jest.fn(),
    } as unknown as Repository<PaperPromotionCandidateEntity>;
  }

  it('phase 0 delegates queued → promoted to PaperPromotionService.autoPromote', async () => {
    const trades = mkTradesService();
    const promotion = mkPromotionService('promoted');
    const queuedCandidate = mkCandidate({ id: 'q1', status: 'queued' });
    const candidatesRepo = mkCandidatesRepoByStatus({ queued: [queuedCandidate] });
    const tradesRepo = mkTradesRepo();
    const worker = new AutoDriveWorker(
      mkConfigService(mkConfig({ autoPromote: true })),
      trades.svc,
      promotion.svc,
      candidatesRepo,
      tradesRepo,
    );
    const summary = await worker.trigger();
    expect(summary.promoted).toBe(1);
    expect(promotion.autoPromote).toHaveBeenCalledWith(undefined, 'q1');
    // Worker must NOT write the candidate row directly (service owns the transition now).
    expect(candidatesRepo.save).not.toHaveBeenCalled();
  });

  it('phase 0 profit-gate skips candidates below minNetProfitUsd before calling the service', async () => {
    const trades = mkTradesService();
    const promotion = mkPromotionService('promoted');
    const low = mkCandidate({
      id: 'q-low',
      status: 'queued',
      evidence: { netProfitUsd: 1 }, // below minNetProfitUsd=5
    });
    const candidatesRepo = mkCandidatesRepoByStatus({ queued: [low] });
    const tradesRepo = mkTradesRepo();
    const worker = new AutoDriveWorker(
      mkConfigService(mkConfig({ autoPromote: true, minNetProfitUsd: 5 })),
      trades.svc,
      promotion.svc,
      candidatesRepo,
      tradesRepo,
    );
    const summary = await worker.trigger();
    expect(summary.promoted).toBe(0);
    // Service is never reached for a below-threshold candidate.
    expect(promotion.autoPromote).not.toHaveBeenCalled();
  });

  it('phase 0 maps a service "rejected" outcome (gate failure) without crashing', async () => {
    const trades = mkTradesService();
    const promotion = mkPromotionService('rejected'); // drift/score gate failed inside the service
    const queuedCandidate = mkCandidate({ id: 'q1', status: 'queued' });
    const candidatesRepo = mkCandidatesRepoByStatus({ queued: [queuedCandidate] });
    const tradesRepo = mkTradesRepo();
    const worker = new AutoDriveWorker(
      mkConfigService(mkConfig({ autoPromote: true })),
      trades.svc,
      promotion.svc,
      candidatesRepo,
      tradesRepo,
    );
    const summary = await worker.trigger();
    // Rejected candidate does not count as promoted, and the tick does not error.
    expect(summary.promoted).toBe(0);
    expect(summary.ran).toBe(true);
    expect(promotion.autoPromote).toHaveBeenCalledWith(undefined, 'q1');
  });

  it('phase 0 is a no-op when autoPromote=false (service never called)', async () => {
    const trades = mkTradesService();
    const promotion = mkPromotionService('promoted');
    const candidatesRepo = mkCandidatesRepoByStatus({
      queued: [mkCandidate({ id: 'q1', status: 'queued' })],
    });
    const tradesRepo = mkTradesRepo();
    const worker = new AutoDriveWorker(
      mkConfigService(mkConfig({ autoPromote: false })),
      trades.svc,
      promotion.svc,
      candidatesRepo,
      tradesRepo,
    );
    const summary = await worker.trigger();
    expect(summary.promoted).toBe(0);
    expect(promotion.autoPromote).not.toHaveBeenCalled();
  });
});
