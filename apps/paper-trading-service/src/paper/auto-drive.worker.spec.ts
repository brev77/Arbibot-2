import { getArbibotMetricsRegistry } from '@arbibot/nest-platform';
import {
  PaperPromotionCandidateEntity,
  PaperTradeEntity,
} from '@arbibot/persistence';
import { Repository } from 'typeorm';

import { AutoDriveConfigService, type AutoDriveConfig } from './auto-drive-config.service';
import { AutoDriveWorker } from './auto-drive.worker';
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
    const candidatesRepo = {
      find: jest.fn().mockResolvedValue([mkCandidate()]),
    } as never;
    const tradesRepo = mkTradesRepo();
    const worker = new AutoDriveWorker(
      mkConfigService(mkConfig()),
      trades.svc,
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
      candidatesRepo,
      tradesRepo,
    );
    const summary = await worker.trigger();
    expect(summary.draftsCreated).toBe(1); // c1 failed, c2 succeeded
    expect(trades.create).toHaveBeenCalledTimes(2);
  });
});
