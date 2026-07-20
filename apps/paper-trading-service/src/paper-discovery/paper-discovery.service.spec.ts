import { ConflictException } from '@nestjs/common';
import {
  QueryFailedError,
  type Repository,
  type EntityManager,
} from 'typeorm';

import type { AuditClientService } from '@arbibot/nest-platform';

import {
  PaperDiscoveryCandidateEntity,
  PaperTradeEntity,
} from '@arbibot/persistence';

import { PaperDiscoveryService } from './paper-discovery.service';

/**
 * PaperDiscoveryService spec (P3-4 discovery pipeline).
 *
 * Pattern A: direct instantiation with lightweight Repository + audit mocks.
 * The service combines three concerns — env-based config, remote config merge
 * (signedFetch) and DB CRUD with optimistic concurrency — so every branch is
 * exercisable through repo + fetch stubs without bootstrapping Nest.
 */

const auditMock = {
  appendEntry: jest.fn().mockResolvedValue(undefined),
} as unknown as AuditClientService;

type CandidateRepo = Repository<PaperDiscoveryCandidateEntity>;

interface RepoShape {
  find: jest.Mock;
  findOne: jest.Mock;
  create: jest.Mock;
  save: jest.Mock;
  manager: { transaction: jest.Mock };
}

function mkCandidate(
  over: Partial<PaperDiscoveryCandidateEntity> = {},
): PaperDiscoveryCandidateEntity {
  return {
    id: 'c-1',
    token_key: 'BTC',
    route_key: 'btc-eth-uniswap',
    bid_price: '100.0',
    ask_price: '101.0',
    theoretical_profit_usd: '1.000000',
    liquidity_score: '0.9000',
    is_eligible: true,
    status: 'discovered',
    entity_version: 1,
    created_at: new Date('2026-07-17T12:00:00Z'),
    processed_at: null,
    ...over,
  };
}

function mkRepo(over: Partial<RepoShape> = {}): RepoShape {
  return {
    find: jest.fn().mockResolvedValue([]),
    findOne: jest.fn().mockResolvedValue(null),
    create: jest.fn((values) => ({ ...values })),
    save: jest.fn((entity) => Promise.resolve(entity)),
    manager: {
      transaction: jest.fn(async (cb: (em: EntityManager) => Promise<unknown>) =>
        cb({
          findOne: jest.fn().mockResolvedValue(null),
          save: jest.fn((e) => Promise.resolve(e)),
        } as unknown as EntityManager),
      ),
    },
    ...over,
  };
}

function mkService(repo: RepoShape): PaperDiscoveryService {
  return new PaperDiscoveryService(
    repo as unknown as CandidateRepo,
    {} as Repository<PaperTradeEntity>,
    auditMock,
  );
}

const ENV_KEYS = [
  'PAPER_DISCOVERY_ENABLED',
  'PAPER_DISCOVERY_INTERVAL_MS',
  'PAPER_DISCOVERY_MIN_PROFIT_USD',
  'PAPER_DISCOVERY_MIN_LIQUIDITY_SCORE',
  'PAPER_DISCOVERY_MAX_CANDIDATES_PER_RUN',
  'PAPER_DISCOVERY_PAPER_ONLY_TOKENS',
  'PAPER_DISCOVERY_PAPER_ONLY_ROUTES',
  'PAPER_DISCOVERY_CONFIG_CACHE_MS',
  'PAPER_DISCOVERY_CONFIG_ENVIRONMENT',
  'PAPER_DISCOVERY_CONFIG_TENANT_ID',
  'CONFIG_SERVICE_URL',
  'CONFIG_API_BASE',
  'MARKET_INTAKE_SERVICE_URL',
] as const;

function clearEnv(): void {
  for (const key of ENV_KEYS) {
    delete process.env[key];
  }
}

describe('PaperDiscoveryService', () => {
  const origEnv: Record<string, string | undefined> = {};
  const origFetch = globalThis.fetch;

  beforeAll(() => {
    for (const key of ENV_KEYS) {
      origEnv[key] = process.env[key];
    }
  });

  beforeEach(() => {
    clearEnv();
    jest.clearAllMocks();
    globalThis.fetch = origFetch;
  });

  afterAll(() => {
    clearEnv();
    for (const key of ENV_KEYS) {
      if (origEnv[key] !== undefined) {
        process.env[key] = origEnv[key];
      }
    }
    globalThis.fetch = origFetch;
  });

  describe('constructor / env config', () => {
    it('loads default config when no env vars are set', () => {
      const svc = mkService(mkRepo());
      const cfg = svc.getConfig();
      expect(cfg.enabled).toBe(true);
      expect(cfg.intervalMs).toBeGreaterThanOrEqual(5000);
      expect(cfg.minProfitUsd).toBeGreaterThanOrEqual(0);
      expect(cfg.minLiquidityScore).toBeGreaterThanOrEqual(0);
      expect(cfg.minLiquidityScore).toBeLessThanOrEqual(1);
      expect(cfg.maxCandidatesPerRun).toBeGreaterThanOrEqual(1);
      expect(svc.isEnabled()).toBe(true);
    });

    it('honours all PAPER_DISCOVERY_* env vars', () => {
      process.env.PAPER_DISCOVERY_ENABLED = 'false';
      process.env.PAPER_DISCOVERY_INTERVAL_MS = '60000';
      process.env.PAPER_DISCOVERY_MIN_PROFIT_USD = '20';
      process.env.PAPER_DISCOVERY_MIN_LIQUIDITY_SCORE = '0.8';
      process.env.PAPER_DISCOVERY_MAX_CANDIDATES_PER_RUN = '100';

      const svc = mkService(mkRepo());
      const cfg = svc.getConfig();

      expect(cfg.enabled).toBe(false);
      expect(cfg.intervalMs).toBe(60000);
      expect(cfg.minProfitUsd).toBe(20);
      expect(cfg.minLiquidityScore).toBe(0.8);
      expect(cfg.maxCandidatesPerRun).toBe(100);
      expect(svc.isEnabled()).toBe(false);
    });

    it('clamps env interval below 5s floor', () => {
      process.env.PAPER_DISCOVERY_INTERVAL_MS = '1000';
      const svc = mkService(mkRepo());
      expect(svc.getConfig().intervalMs).toBe(5000);
    });

    it('clamps env minProfitUsd below 0 floor', () => {
      process.env.PAPER_DISCOVERY_MIN_PROFIT_USD = '-5';
      const svc = mkService(mkRepo());
      expect(svc.getConfig().minProfitUsd).toBe(0);
    });

    it('clamps env minLiquidityScore to [0,1] range', () => {
      process.env.PAPER_DISCOVERY_MIN_LIQUIDITY_SCORE = '2.5';
      const svc = mkService(mkRepo());
      expect(svc.getConfig().minLiquidityScore).toBe(1);
    });

    it('clamps env maxCandidatesPerRun to [1,500] range', () => {
      process.env.PAPER_DISCOVERY_MAX_CANDIDATES_PER_RUN = '99999';
      const svc = mkService(mkRepo());
      expect(svc.getConfig().maxCandidatesPerRun).toBe(500);
    });
  });

  describe('getFallbackPaperOnlyFilters', () => {
    it('returns empty array when env lists are empty', () => {
      const svc = mkService(mkRepo());
      expect(svc['getFallbackPaperOnlyFilters']()).toEqual([]);
    });

    it('expands cartesian product of tokens × routes', () => {
      process.env.PAPER_DISCOVERY_PAPER_ONLY_TOKENS = 'BTC,ETH';
      process.env.PAPER_DISCOVERY_PAPER_ONLY_ROUTES = 'r1,r2';
      const svc = mkService(mkRepo());
      const filters = svc['getFallbackPaperOnlyFilters']();
      expect(filters).toHaveLength(4);
      expect(filters).toContainEqual({
        tokenKey: 'BTC',
        routeKey: 'r1',
        isPaperOnly: true,
      });
      expect(filters).toContainEqual({
        tokenKey: 'ETH',
        routeKey: 'r2',
        isPaperOnly: true,
      });
    });

    it('trims whitespace and skips empty tokens', () => {
      process.env.PAPER_DISCOVERY_PAPER_ONLY_TOKENS = '  BTC  ,  ,ETH';
      process.env.PAPER_DISCOVERY_PAPER_ONLY_ROUTES = 'r1';
      const svc = mkService(mkRepo());
      const filters = svc['getFallbackPaperOnlyFilters']();
      expect(filters).toHaveLength(2);
      expect(filters.map((f) => f.tokenKey)).toEqual(['BTC', 'ETH']);
    });
  });

  describe('profileSnapshot', () => {
    const paperOnlyFilters = [
      { tokenKey: 'BTC', routeKey: 'btc-eth-uniswap', isPaperOnly: true },
    ];

    const mkSnapshot = (over: Partial<Record<string, unknown>> = {}) => ({
      id: 'snap-1',
      instrumentKey: 'BTC',
      routeKey: 'btc-eth-uniswap',
      bidPrice: '100.0',
      askPrice: '101.0',
      timestamp: new Date(),
      isStale: false,
      ...over,
    });

    it('returns null when token/route combination is not paper-only', () => {
      const svc = mkService(mkRepo());
      const result = svc['profileSnapshot'](
        mkSnapshot({ instrumentKey: 'ETH' }),
        paperOnlyFilters,
      );
      expect(result).toBeNull();
    });

    it('returns null when filter is marked not paper-only', () => {
      const svc = mkService(mkRepo());
      const result = svc['profileSnapshot'](mkSnapshot(), [
        { tokenKey: 'BTC', routeKey: 'btc-eth-uniswap', isPaperOnly: false },
      ]);
      expect(result).toBeNull();
    });

    it('returns null when bid price is invalid', () => {
      const svc = mkService(mkRepo());
      const result = svc['profileSnapshot'](
        mkSnapshot({ bidPrice: 'NaN' }),
        paperOnlyFilters,
      );
      expect(result).toBeNull();
    });

    it('returns null when ask price is zero (div-by-zero guard)', () => {
      const svc = mkService(mkRepo());
      const result = svc['profileSnapshot'](
        mkSnapshot({ bidPrice: '100.0', askPrice: '0' }),
        paperOnlyFilters,
      );
      expect(result).toBeNull();
    });

    it('computes profit and liquidity score strings', () => {
      const svc = mkService(mkRepo());
      const result = svc['profileSnapshot'](mkSnapshot(), paperOnlyFilters);
      expect(result).not.toBeNull();
      expect(result?.tokenKey).toBe('BTC');
      expect(result?.routeKey).toBe('btc-eth-uniswap');
      expect(result?.bidPrice).toBe('100.0');
      expect(result?.askPrice).toBe('101.0');
      expect(parseFloat(result?.theoreticalProfitUsd ?? 'x')).toBe(1.0);
    });

    it('marks candidate eligible when thresholds are met', () => {
      process.env.PAPER_DISCOVERY_MIN_PROFIT_USD = '0.5';
      process.env.PAPER_DISCOVERY_MIN_LIQUIDITY_SCORE = '0.1';
      const svc = mkService(mkRepo());
      const result = svc['profileSnapshot'](mkSnapshot(), paperOnlyFilters);
      expect(result?.isEligible).toBe(true);
    });

    it('marks candidate ineligible when profit below threshold', () => {
      process.env.PAPER_DISCOVERY_MIN_PROFIT_USD = '10';
      const svc = mkService(mkRepo());
      const result = svc['profileSnapshot'](mkSnapshot(), paperOnlyFilters);
      expect(result?.isEligible).toBe(false);
    });

    it('marks candidate ineligible when liquidity below threshold', () => {
      process.env.PAPER_DISCOVERY_MIN_LIQUIDITY_SCORE = '0.99';
      process.env.PAPER_DISCOVERY_MIN_PROFIT_USD = '0';
      const svc = mkService(mkRepo());
      const result = svc['profileSnapshot'](
        mkSnapshot({ bidPrice: '100.0', askPrice: '110.0' }),
        paperOnlyFilters,
      );
      expect(result?.isEligible).toBe(false);
    });

    it('clamps theoretical profit to 0 when bid > ask', () => {
      const svc = mkService(mkRepo());
      const result = svc['profileSnapshot'](
        mkSnapshot({ bidPrice: '105', askPrice: '100' }),
        paperOnlyFilters,
      );
      expect(result).not.toBeNull();
      expect(parseFloat(result?.theoreticalProfitUsd ?? 'x')).toBe(0);
    });
  });

  describe('list', () => {
    it('forwards status filter + limit and returns rows DESC', async () => {
      const find = jest.fn().mockResolvedValue([mkCandidate()]);
      const svc = mkService(mkRepo({ find }));
      const rows = await svc.list('processed', 50);
      expect(find).toHaveBeenCalledWith({
        where: { status: 'processed' },
        order: { created_at: 'DESC' },
        take: 50,
      });
      expect(rows).toHaveLength(1);
    });

    it('omits status filter when status is empty string', async () => {
      const find = jest.fn().mockResolvedValue([]);
      const svc = mkService(mkRepo({ find }));
      await svc.list('', 10);
      expect(find).toHaveBeenCalledWith({
        where: {},
        order: { created_at: 'DESC' },
        take: 10,
      });
    });

    it('omits status filter when status is undefined', async () => {
      const find = jest.fn().mockResolvedValue([]);
      const svc = mkService(mkRepo({ find }));
      await svc.list(undefined, 10);
      expect(find).toHaveBeenCalledWith({
        where: {},
        order: { created_at: 'DESC' },
        take: 10,
      });
    });
  });

  describe('create', () => {
    const dto = {
      tokenKey: 'BTC',
      routeKey: 'btc-eth-uniswap',
      bidPrice: '100.0',
      askPrice: '101.0',
      theoreticalProfitUsd: '1.0',
      liquidityScore: '0.9',
      isEligible: true,
    };

    it('returns existing row when duplicate candidate is found', async () => {
      const existing = mkCandidate({ id: 'dup-id' });
      const findOne = jest.fn().mockResolvedValue(existing);
      const create = jest.fn();
      const save = jest.fn();
      const svc = mkService(mkRepo({ findOne, create, save }));

      const row = await svc.create(dto);

      expect(row?.id).toBe('dup-id');
      expect(create).not.toHaveBeenCalled();
      expect(save).not.toHaveBeenCalled();
    });

    it('creates and saves a new discovered candidate', async () => {
      const findOne = jest.fn().mockResolvedValue(null);
      const create = jest.fn((values) => ({ ...values }));
      const save = jest.fn((e) => Promise.resolve({ ...e, id: 'new-id' }));
      const svc = mkService(mkRepo({ findOne, create, save }));

      const row = await svc.create(dto);

      expect(row?.id).toBe('new-id');
      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({
          token_key: 'BTC',
          route_key: 'btc-eth-uniswap',
          bid_price: '100.0',
          ask_price: '101.0',
          status: 'discovered',
          entity_version: 1,
          processed_at: null,
        }),
      );
      // MoreThan(ts) used as dedup filter
      const callArg = findOne.mock.calls[0][0];
      expect(callArg.where.token_key).toBe('BTC');
      expect(callArg.where.route_key).toBe('btc-eth-uniswap');
      expect(callArg.where.created_at).toBeDefined();
      expect(typeof callArg.where.created_at).toBe('object');
    });

    it('replays existing candidate after unique constraint 23505 violation', async () => {
      const findOne = jest
        .fn()
        .mockResolvedValueOnce(null) // dedup pre-check: none
        .mockResolvedValueOnce(mkCandidate({ id: 'race-id' })); // replay after 23505

      const save = jest.fn().mockImplementation(() => {
        const err = new QueryFailedError(
          'SELECT',
          [],
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          { code: '23505' } as any,
        );
        throw err;
      });

      const svc = mkService(mkRepo({ findOne, save }));

      const row = await svc.create(dto);

      expect(row?.id).toBe('race-id');
      expect(save).toHaveBeenCalledTimes(1);
      // second findOne call (post-conflict replay)
      expect(findOne).toHaveBeenCalledTimes(2);
    });

    it('rethrows non-23505 QueryFailedError', async () => {
      const findOne = jest.fn().mockResolvedValue(null);
      const save = jest.fn().mockImplementation(() => {
        const err = new QueryFailedError(
          'SELECT',
          [],
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          { code: '42P01' } as any,
        );
        throw err;
      });
      const svc = mkService(mkRepo({ findOne, save }));

      await expect(svc.create(dto)).rejects.toBeInstanceOf(QueryFailedError);
    });

    it('rethrows non-QueryFailedError errors', async () => {
      const findOne = jest.fn().mockResolvedValue(null);
      const save = jest.fn().mockRejectedValue(new Error('boom'));
      const svc = mkService(mkRepo({ findOne, save }));

      await expect(svc.create(dto)).rejects.toThrow('boom');
    });
  });

  describe('updateStatus', () => {
    it('returns null when candidate is not found', async () => {
      const findOne = jest.fn().mockResolvedValue(null);
      const transaction = jest.fn(async (cb: (em: EntityManager) => Promise<unknown>) =>
        cb({
          findOne,
          save: jest.fn(),
        } as unknown as EntityManager),
      );
      const svc = mkService(
        mkRepo({ manager: { transaction } }),
      );

      const result = await svc.updateStatus('c-missing', 'processed', 1);
      expect(result).toBeNull();
    });

    it('throws ConflictException on version mismatch', async () => {
      const candidate = mkCandidate({ entity_version: 5 });
      const emFindOne = jest.fn().mockResolvedValue(candidate);
      const transaction = jest.fn(async (cb: (em: EntityManager) => Promise<unknown>) =>
        cb({
          findOne: emFindOne,
          save: jest.fn(),
        } as unknown as EntityManager),
      );
      const svc = mkService(
        mkRepo({ manager: { transaction } }),
      );

      await expect(svc.updateStatus('c-1', 'processed', 1)).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('bumps version, sets processed_at and saves on terminal transition', async () => {
      const candidate = mkCandidate({ entity_version: 2 });
      const emFindOne = jest.fn().mockResolvedValue(candidate);
      const emSave = jest.fn((_t: unknown, e: unknown) => Promise.resolve(e));
      const transaction = jest.fn(async (cb: (em: EntityManager) => Promise<unknown>) =>
        cb({
          findOne: emFindOne,
          save: emSave,
        } as unknown as EntityManager),
      );
      const svc = mkService(mkRepo({ manager: { transaction } }));

      const result = await svc.updateStatus('c-1', 'rejected', 2);

      expect(result?.status).toBe('rejected');
      expect(result?.entity_version).toBe(3);
      expect(result?.processed_at).toBeInstanceOf(Date);
      expect(emSave).toHaveBeenCalled();
    });

    it('skips processed_at when transitioning to discovered state', async () => {
      const candidate = mkCandidate({
        entity_version: 2,
        status: 'processed',
        processed_at: new Date('2026-07-17T12:00:00Z'),
      });
      const emFindOne = jest.fn().mockResolvedValue(candidate);
      const emSave = jest.fn((_t: unknown, e: unknown) => Promise.resolve(e));
      const transaction = jest.fn(async (cb: (em: EntityManager) => Promise<unknown>) =>
        cb({
          findOne: emFindOne,
          save: emSave,
        } as unknown as EntityManager),
      );
      const svc = mkService(mkRepo({ manager: { transaction } }));

      const result = await svc.updateStatus('c-1', 'discovered', 2);

      expect(result?.processed_at).toBeInstanceOf(Date);
      expect(result?.processed_at).toEqual(
        new Date('2026-07-17T12:00:00Z'),
      );
    });
  });

  describe('processEligibleCandidate', () => {
    it('fails when candidate is not found', async () => {
      const svc = mkService(mkRepo({ findOne: jest.fn().mockResolvedValue(null) }));
      const result = await svc.processEligibleCandidate('missing', 'op-1');
      expect(result).toEqual({
        success: false,
        error: 'Discovery candidate not found',
        paperTradeId: null,
      });
    });

    it('fails when candidate is not in discovered state', async () => {
      const svc = mkService(
        mkRepo({
          findOne: jest.fn().mockResolvedValue(
            mkCandidate({ status: 'processed' }),
          ),
        }),
      );
      const result = await svc.processEligibleCandidate('c-1', 'op-1');
      expect(result.success).toBe(false);
      expect(result.error).toContain('invalid state');
    });

    it('fails when candidate is not eligible', async () => {
      const svc = mkService(
        mkRepo({
          findOne: jest.fn().mockResolvedValue(
            mkCandidate({ is_eligible: false }),
          ),
        }),
      );
      const result = await svc.processEligibleCandidate('c-1', 'op-1');
      expect(result).toEqual({
        success: false,
        error: 'Candidate is not eligible',
        paperTradeId: null,
      });
    });

    it('processes eligible discovered candidate + records audit', async () => {
      const candidate = mkCandidate({ entity_version: 1 });
      const updatedCandidate = mkCandidate({
        entity_version: 2,
        status: 'processed',
      });
      const findOne = jest.fn().mockResolvedValue(candidate);
      const emFindOne = jest.fn().mockResolvedValue(candidate);
      const emSave = jest.fn().mockResolvedValue(updatedCandidate);
      const transaction = jest.fn(async (cb: (em: EntityManager) => Promise<unknown>) =>
        cb({
          findOne: emFindOne,
          save: emSave,
        } as unknown as EntityManager),
      );
      const svc = mkService(
        mkRepo({ findOne, manager: { transaction } }),
      );

      const result = await svc.processEligibleCandidate('c-1', 'op-1');

      expect(result.success).toBe(true);
      expect(result.paperTradeId).toBe('c-1');
      expect(auditMock.appendEntry).toHaveBeenCalledWith(
        expect.objectContaining({
          actor: 'op-1',
          action: 'paper_discovery_candidate_processed',
          resourceId: 'c-1',
        }),
      );
    });

    it('swallows audit appendEntry rejections and still returns success', async () => {
      const candidate = mkCandidate({ entity_version: 1 });
      const findOne = jest.fn().mockResolvedValue(candidate);
      const transaction = jest.fn(async (cb: (em: EntityManager) => Promise<unknown>) =>
        cb({
          findOne: jest.fn().mockResolvedValue(candidate),
          save: jest.fn().mockResolvedValue(candidate),
        } as unknown as EntityManager),
      );
      const appendEntry = jest
        .fn()
        .mockRejectedValue(new Error('audit down'));
      const svc = new PaperDiscoveryService(
        mkRepo({ findOne, manager: { transaction } }) as unknown as CandidateRepo,
        {} as Repository<PaperTradeEntity>,
        { appendEntry } as unknown as AuditClientService,
      );

      // Need to wait for the swallowed audit promise to settle
      const result = await svc.processEligibleCandidate('c-1', 'op-1');
      await new Promise((r) => setImmediate(r));

      expect(result.success).toBe(true);
      expect(appendEntry).toHaveBeenCalled();
    });

    it('returns failure when updateStatus throws', async () => {
      // processEligibleCandidate finds candidate with version=5 (discovered),
      // passes expectedVersion=5 to updateStatus. Inside the transaction,
      // emFindOne re-reads with a DIFFERENT version (1) → ConflictException.
      const candidate = mkCandidate({ entity_version: 5, status: 'discovered' });
      const findOne = jest.fn().mockResolvedValue(candidate);
      const staleCandidate = mkCandidate({ entity_version: 1, status: 'discovered' });
      const emFindOne = jest.fn().mockResolvedValue(staleCandidate);
      const emSave = jest.fn();
      const transaction = jest.fn(async (cb: (em: EntityManager) => Promise<unknown>) =>
        cb({
          findOne: emFindOne,
          save: emSave,
        } as unknown as EntityManager),
      );
      const svc = mkService(
        mkRepo({ findOne, manager: { transaction } }),
      );

      const result = await svc.processEligibleCandidate('c-1', 'op-1');

      expect(result.success).toBe(false);
      expect(result.paperTradeId).toBeNull();
    });

    it('returns failure on non-Error throw', async () => {
      const candidate = mkCandidate({ entity_version: 1 });
      const findOne = jest.fn().mockResolvedValue(candidate);
      const transaction = jest.fn(() =>
        // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
        Promise.reject('string-throw'),
      );
      const svc = mkService(mkRepo({ findOne, manager: { transaction } }));

      const result = await svc.processEligibleCandidate('c-1', 'op-1');

      expect(result.success).toBe(false);
      expect(result.error).toBe('string-throw');
    });
  });

  describe('rejectCandidate', () => {
    it('fails when candidate is not found', async () => {
      const svc = mkService(mkRepo({ findOne: jest.fn().mockResolvedValue(null) }));
      const result = await svc.rejectCandidate('missing', 'op-1');
      expect(result).toEqual({ success: false, error: 'Candidate not found' });
    });

    it('fails when candidate is not in discovered state', async () => {
      const svc = mkService(
        mkRepo({
          findOne: jest.fn().mockResolvedValue(
            mkCandidate({ status: 'processed' }),
          ),
        }),
      );
      const result = await svc.rejectCandidate('c-1', 'op-1');
      expect(result.success).toBe(false);
      expect(result.error).toContain('invalid state');
    });

    it('rejects candidate, updates status and records audit', async () => {
      const candidate = mkCandidate({ entity_version: 1 });
      const rejectedCandidate = mkCandidate({
        entity_version: 2,
        status: 'rejected',
      });
      const findOne = jest.fn().mockResolvedValue(candidate);
      const emFindOne = jest.fn().mockResolvedValue(candidate);
      const emSave = jest.fn().mockResolvedValue(rejectedCandidate);
      const transaction = jest.fn(async (cb: (em: EntityManager) => Promise<unknown>) =>
        cb({
          findOne: emFindOne,
          save: emSave,
        } as unknown as EntityManager),
      );
      const svc = mkService(mkRepo({ findOne, manager: { transaction } }));

      const result = await svc.rejectCandidate('c-1', 'op-1');

      expect(result.success).toBe(true);
      expect(auditMock.appendEntry).toHaveBeenCalledWith(
        expect.objectContaining({
          actor: 'op-1',
          action: 'paper_discovery_candidate_rejected',
        }),
      );
    });

    it('returns failure when updateStatus throws (version mismatch)', async () => {
      // rejectCandidate finds candidate with version=5 (discovered),
      // passes expectedVersion=5 to updateStatus. Inside the transaction,
      // emFindOne re-reads with a DIFFERENT version (1) → ConflictException.
      const candidate = mkCandidate({ entity_version: 5, status: 'discovered' });
      const staleCandidate = mkCandidate({ entity_version: 1, status: 'discovered' });
      const findOne = jest.fn().mockResolvedValue(candidate);
      const transaction = jest.fn(async (cb: (em: EntityManager) => Promise<unknown>) =>
        cb({
          findOne: jest.fn().mockResolvedValue(staleCandidate),
          save: jest.fn(),
        } as unknown as EntityManager),
      );
      const svc = mkService(mkRepo({ findOne, manager: { transaction } }));

      const result = await svc.rejectCandidate('c-1', 'op-1');

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('returns failure on non-Error throw from updateStatus', async () => {
      const candidate = mkCandidate({ entity_version: 1 });
      const findOne = jest.fn().mockResolvedValue(candidate);
      const transaction = jest.fn(() =>
        // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
        Promise.reject('reject-failed'),
      );
      const svc = mkService(mkRepo({ findOne, manager: { transaction } }));

      const result = await svc.rejectCandidate('c-1', 'op-1');

      expect(result.success).toBe(false);
      expect(result.error).toBe('reject-failed');
    });

    it('swallows audit failures silently', async () => {
      const candidate = mkCandidate({ entity_version: 1 });
      const findOne = jest.fn().mockResolvedValue(candidate);
      const transaction = jest.fn(async (cb: (em: EntityManager) => Promise<unknown>) =>
        cb({
          findOne: jest.fn().mockResolvedValue(candidate),
          save: jest.fn().mockResolvedValue(candidate),
        } as unknown as EntityManager),
      );
      const appendEntry = jest.fn().mockRejectedValue(new Error('audit'));
      const svc = new PaperDiscoveryService(
        mkRepo({ findOne, manager: { transaction } }) as unknown as CandidateRepo,
        {} as Repository<PaperTradeEntity>,
        { appendEntry } as unknown as AuditClientService,
      );

      const result = await svc.rejectCandidate('c-1', 'op-1');
      await new Promise((r) => setImmediate(r));

      expect(result.success).toBe(true);
      expect(appendEntry).toHaveBeenCalled();
    });
  });

  describe('fetchFreshSnapshots', () => {
    it('returns empty array when MARKET_INTAKE_SERVICE_URL is unset', async () => {
      const svc = mkService(mkRepo());
      const result = await svc.fetchFreshSnapshots();
      expect(result).toEqual([]);
    });

    it('parses items into MarketSnapshot shape', async () => {
      process.env.MARKET_INTAKE_SERVICE_URL = 'http://intake.test';
      globalThis.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            items: [
              {
                id: 's-1',
                venueCode: 'binance',
                venueSymbol: 'BTCUSDT',
                instrumentKey: 'BTC',
                routeKey: 'r1',
                bid: 100,
                ask: 101,
                observedAt: '2026-07-17T12:00:00.000Z',
                isStale: false,
              },
            ],
          }),
      });

      const svc = mkService(mkRepo());
      const result = await svc.fetchFreshSnapshots();

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        id: 's-1',
        instrumentKey: 'BTC',
        routeKey: 'r1',
        bidPrice: '100',
        askPrice: '101',
        timestamp: new Date('2026-07-17T12:00:00.000Z'),
        isStale: false,
      });
    });

    it('filters out items with null instrumentKey/routeKey/bid/ask', async () => {
      process.env.MARKET_INTAKE_SERVICE_URL = 'http://intake.test';
      globalThis.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            items: [
              {
                id: 's-1',
                venueCode: 'binance',
                venueSymbol: 'BTCUSDT',
                instrumentKey: null,
                routeKey: 'r1',
                bid: 100,
                ask: 101,
                observedAt: '2026-07-17T12:00:00.000Z',
                isStale: false,
              },
              {
                id: 's-2',
                venueCode: 'binance',
                venueSymbol: 'BTCUSDT',
                instrumentKey: 'BTC',
                routeKey: 'r1',
                bid: null,
                ask: 101,
                observedAt: '2026-07-17T12:00:00.000Z',
                isStale: false,
              },
              {
                id: 's-3',
                venueCode: 'binance',
                venueSymbol: 'BTCUSDT',
                instrumentKey: 'BTC',
                routeKey: 'r1',
                bid: 100,
                ask: 101,
                observedAt: '2026-07-17T12:00:00.000Z',
                isStale: false,
              },
            ],
          }),
      });

      const svc = mkService(mkRepo());
      const result = await svc.fetchFreshSnapshots();
      expect(result).toHaveLength(1);
      expect(result[0]?.id).toBe('s-3');
    });

    it('returns empty array when fetch response is not ok', async () => {
      process.env.MARKET_INTAKE_SERVICE_URL = 'http://intake.test';
      globalThis.fetch = jest.fn().mockResolvedValue({ ok: false, status: 500 });

      const svc = mkService(mkRepo());
      const result = await svc.fetchFreshSnapshots();
      expect(result).toEqual([]);
    });

    it('returns empty array when fetch throws (network error)', async () => {
      process.env.MARKET_INTAKE_SERVICE_URL = 'http://intake.test';
      globalThis.fetch = jest.fn().mockRejectedValue(new Error('network'));

      const svc = mkService(mkRepo());
      const result = await svc.fetchFreshSnapshots();
      expect(result).toEqual([]);
    });

    it('returns empty array when fetch throws non-Error value', async () => {
      process.env.MARKET_INTAKE_SERVICE_URL = 'http://intake.test';
      globalThis.fetch = jest.fn().mockRejectedValue('netfail');

      const svc = mkService(mkRepo());
      const result = await svc.fetchFreshSnapshots();
      expect(result).toEqual([]);
    });
  });

  describe('fetchPaperOnlyFilters / ensureEffectiveConfigLoaded', () => {
    it('falls back to env filters when config URL is unset', async () => {
      process.env.PAPER_DISCOVERY_PAPER_ONLY_TOKENS = 'BTC';
      process.env.PAPER_DISCOVERY_PAPER_ONLY_ROUTES = 'r1';
      const svc = mkService(mkRepo());

      const filters = await svc.fetchPaperOnlyFilters();
      expect(filters).toEqual([
        { tokenKey: 'BTC', routeKey: 'r1', isPaperOnly: true },
      ]);
    });

    it('returns merged filters from remote JSON when fetch succeeds', async () => {
      process.env.CONFIG_SERVICE_URL = 'http://cfg.test';
      process.env.PAPER_DISCOVERY_CONFIG_CACHE_MS = '60000';
      globalThis.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            configValue: JSON.stringify({
              paperOnlyTokens: ['BTC'],
              paperOnlyRoutes: ['r1'],
              minProfitUsd: 5,
            }),
          }),
      });

      const svc = mkService(mkRepo());
      const filters = await svc.fetchPaperOnlyFilters();

      expect(filters).toEqual([
        { tokenKey: 'BTC', routeKey: 'r1', isPaperOnly: true },
      ]);
      expect(svc.getConfig().minProfitUsd).toBe(5);
    });

    it('forwards environment and tenantId query params when set', async () => {
      process.env.CONFIG_SERVICE_URL = 'http://cfg.test/';
      process.env.PAPER_DISCOVERY_CONFIG_ENVIRONMENT = 'staging';
      process.env.PAPER_DISCOVERY_CONFIG_TENANT_ID = 'tenant-1';
      globalThis.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            configValue: JSON.stringify({
              paperOnlyTokens: ['BTC'],
              paperOnlyRoutes: ['r1'],
            }),
          }),
      });

      const svc = mkService(mkRepo());
      await svc.fetchPaperOnlyFilters();

      const calledUrl = (globalThis.fetch as jest.Mock).mock.calls[0][0] as string;
      expect(calledUrl).toContain('environment=staging');
      expect(calledUrl).toContain('tenantId=tenant-1');
      expect(calledUrl).toContain('http://cfg.test/'); // trailing slash stripped
    });

    it('falls back to env filters when remote responds non-ok', async () => {
      process.env.CONFIG_API_BASE = 'http://cfg.test';
      process.env.PAPER_DISCOVERY_PAPER_ONLY_TOKENS = 'ETH';
      process.env.PAPER_DISCOVERY_PAPER_ONLY_ROUTES = 'r2';
      globalThis.fetch = jest.fn().mockResolvedValue({ ok: false, status: 500 });

      const svc = mkService(mkRepo());
      const filters = await svc.fetchPaperOnlyFilters();
      expect(filters).toEqual([
        { tokenKey: 'ETH', routeKey: 'r2', isPaperOnly: true },
      ]);
    });

    it('falls back to env filters when configValue is undefined', async () => {
      process.env.CONFIG_SERVICE_URL = 'http://cfg.test';
      process.env.PAPER_DISCOVERY_PAPER_ONLY_TOKENS = 'ETH';
      process.env.PAPER_DISCOVERY_PAPER_ONLY_ROUTES = 'r2';
      globalThis.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ configValue: undefined }),
      });

      const svc = mkService(mkRepo());
      const filters = await svc.fetchPaperOnlyFilters();
      expect(filters).toEqual([
        { tokenKey: 'ETH', routeKey: 'r2', isPaperOnly: true },
      ]);
    });

    it('falls back to env filters when configValue is non-string', async () => {
      process.env.CONFIG_SERVICE_URL = 'http://cfg.test';
      process.env.PAPER_DISCOVERY_PAPER_ONLY_TOKENS = 'ETH';
      process.env.PAPER_DISCOVERY_PAPER_ONLY_ROUTES = 'r2';
      globalThis.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ configValue: 42 }),
      });

      const svc = mkService(mkRepo());
      const filters = await svc.fetchPaperOnlyFilters();
      expect(filters).toEqual([
        { tokenKey: 'ETH', routeKey: 'r2', isPaperOnly: true },
      ]);
    });

    it('falls back to env filters when configValue JSON is malformed', async () => {
      process.env.CONFIG_SERVICE_URL = 'http://cfg.test';
      process.env.PAPER_DISCOVERY_PAPER_ONLY_TOKENS = 'ETH';
      process.env.PAPER_DISCOVERY_PAPER_ONLY_ROUTES = 'r2';
      globalThis.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ configValue: '{not-json' }),
      });

      const svc = mkService(mkRepo());
      const filters = await svc.fetchPaperOnlyFilters();
      expect(filters).toEqual([
        { tokenKey: 'ETH', routeKey: 'r2', isPaperOnly: true },
      ]);
    });

    it('falls back to env filters when fetch throws', async () => {
      process.env.CONFIG_SERVICE_URL = 'http://cfg.test';
      process.env.PAPER_DISCOVERY_PAPER_ONLY_TOKENS = 'ETH';
      process.env.PAPER_DISCOVERY_PAPER_ONLY_ROUTES = 'r2';
      globalThis.fetch = jest.fn().mockRejectedValue(new Error('net'));

      const svc = mkService(mkRepo());
      const filters = await svc.fetchPaperOnlyFilters();
      expect(filters).toEqual([
        { tokenKey: 'ETH', routeKey: 'r2', isPaperOnly: true },
      ]);
    });

    it('falls back to env filters when fetch throws non-Error', async () => {
      process.env.CONFIG_SERVICE_URL = 'http://cfg.test';
      process.env.PAPER_DISCOVERY_PAPER_ONLY_TOKENS = 'ETH';
      process.env.PAPER_DISCOVERY_PAPER_ONLY_ROUTES = 'r2';
      globalThis.fetch = jest.fn().mockRejectedValue('netfail');

      const svc = mkService(mkRepo());
      const filters = await svc.fetchPaperOnlyFilters();
      expect(filters).toEqual([
        { tokenKey: 'ETH', routeKey: 'r2', isPaperOnly: true },
      ]);
    });

    it('uses cached remote policy within TTL window (single fetch call)', async () => {
      process.env.CONFIG_SERVICE_URL = 'http://cfg.test';
      process.env.PAPER_DISCOVERY_CONFIG_CACHE_MS = '60000';
      const fetchMock = jest.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            configValue: JSON.stringify({
              paperOnlyTokens: ['BTC'],
              paperOnlyRoutes: ['r1'],
              minProfitUsd: 7,
            }),
          }),
      });
      globalThis.fetch = fetchMock;

      const svc = mkService(mkRepo());

      // First call: triggers fetch
      await svc.fetchPaperOnlyFilters();
      expect(fetchMock).toHaveBeenCalledTimes(1);

      // Second call within TTL: should use cache, no new fetch
      const filters2 = await svc.fetchPaperOnlyFilters();
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(filters2).toEqual([
        { tokenKey: 'BTC', routeKey: 'r1', isPaperOnly: true },
      ]);
      expect(svc.getConfig().minProfitUsd).toBe(7);
    });

    it('clamps PAPER_DISCOVERY_CONFIG_CACHE_MS to 5s floor', async () => {
      process.env.CONFIG_SERVICE_URL = 'http://cfg.test';
      process.env.PAPER_DISCOVERY_CONFIG_CACHE_MS = '1';
      const fetchMock = jest.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            configValue: JSON.stringify({ paperOnlyTokens: ['BTC'], paperOnlyRoutes: ['r1'] }),
          }),
      });
      globalThis.fetch = fetchMock;

      const svc = mkService(mkRepo());

      await svc.fetchPaperOnlyFilters();
      await svc.fetchPaperOnlyFilters();

      // TTL clamped to 5s; both calls within ms so cache still applies
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });

  describe('applyRemoteJson (via fetchPaperOnlyFilters)', () => {
    it('overrides enabled flag from remote JSON', async () => {
      process.env.CONFIG_SERVICE_URL = 'http://cfg.test';
      globalThis.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            configValue: JSON.stringify({ enabled: false }),
          }),
      });

      const svc = mkService(mkRepo());
      await svc.fetchPaperOnlyFilters();
      expect(svc.isEnabled()).toBe(false);
    });

    it('overrides intervalMs (clamped to 5s) from remote JSON', async () => {
      process.env.CONFIG_SERVICE_URL = 'http://cfg.test';
      globalThis.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            configValue: JSON.stringify({ intervalMs: 1000 }),
          }),
      });

      const svc = mkService(mkRepo());
      await svc.fetchPaperOnlyFilters();
      expect(svc.getConfig().intervalMs).toBe(5000);
    });

    it('overrides minProfitUsd (clamped to >=0) from remote JSON', async () => {
      process.env.CONFIG_SERVICE_URL = 'http://cfg.test';
      globalThis.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            configValue: JSON.stringify({ minProfitUsd: -10 }),
          }),
      });

      const svc = mkService(mkRepo());
      await svc.fetchPaperOnlyFilters();
      expect(svc.getConfig().minProfitUsd).toBe(0);
    });

    it('overrides minLiquidityScore (clamped to [0,1]) from remote JSON', async () => {
      process.env.CONFIG_SERVICE_URL = 'http://cfg.test';
      globalThis.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            configValue: JSON.stringify({ minLiquidityScore: 5 }),
          }),
      });

      const svc = mkService(mkRepo());
      await svc.fetchPaperOnlyFilters();
      expect(svc.getConfig().minLiquidityScore).toBe(1);
    });

    it('overrides maxCandidatesPerRun (clamped to [1,500]) from remote JSON', async () => {
      process.env.CONFIG_SERVICE_URL = 'http://cfg.test';
      globalThis.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            configValue: JSON.stringify({ maxCandidatesPerRun: 1000 }),
          }),
      });

      const svc = mkService(mkRepo());
      await svc.fetchPaperOnlyFilters();
      expect(svc.getConfig().maxCandidatesPerRun).toBe(500);
    });

    it('ignores non-finite numeric remote values', async () => {
      process.env.CONFIG_SERVICE_URL = 'http://cfg.test';
      globalThis.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            configValue: JSON.stringify({
              intervalMs: Number.NaN,
              minProfitUsd: Number.POSITIVE_INFINITY,
              minLiquidityScore: Number.NaN,
              maxCandidatesPerRun: 'oops' as unknown as number,
            }),
          }),
      });

      const svc = mkService(mkRepo());
      const baseline = svc.getConfig();
      await svc.fetchPaperOnlyFilters();

      // None of the non-finite / wrong-type values should override
      expect(svc.getConfig().intervalMs).toBe(baseline.intervalMs);
      expect(svc.getConfig().minProfitUsd).toBe(baseline.minProfitUsd);
      expect(svc.getConfig().minLiquidityScore).toBe(baseline.minLiquidityScore);
      expect(svc.getConfig().maxCandidatesPerRun).toBe(baseline.maxCandidatesPerRun);
    });

    it('returns empty filters when remote has only tokens (no routes)', async () => {
      process.env.CONFIG_SERVICE_URL = 'http://cfg.test';
      globalThis.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            configValue: JSON.stringify({
              paperOnlyTokens: ['BTC'],
              paperOnlyRoutes: [],
            }),
          }),
      });

      process.env.PAPER_DISCOVERY_PAPER_ONLY_TOKENS = '';
      process.env.PAPER_DISCOVERY_PAPER_ONLY_ROUTES = '';
      const svc = mkService(mkRepo());
      const filters = await svc.fetchPaperOnlyFilters();
      expect(filters).toEqual([]);
    });

    it('trims and filters remote token/route lists', async () => {
      process.env.CONFIG_SERVICE_URL = 'http://cfg.test';
      globalThis.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            configValue: JSON.stringify({
              paperOnlyTokens: ['  BTC  ', '', 'ETH'],
              paperOnlyRoutes: ['r1', '   ', 'r2'],
            }),
          }),
      });

      const svc = mkService(mkRepo());
      const filters = await svc.fetchPaperOnlyFilters();
      const tokenKeys = new Set(filters.map((f) => f.tokenKey));
      const routeKeys = new Set(filters.map((f) => f.routeKey));
      expect(tokenKeys).toEqual(new Set(['BTC', 'ETH']));
      expect(routeKeys).toEqual(new Set(['r1', 'r2']));
      expect(filters).toHaveLength(4); // 2 × 2
    });

    it('coerces non-string remote token entries via String()', async () => {
      process.env.CONFIG_SERVICE_URL = 'http://cfg.test';
      globalThis.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            configValue: JSON.stringify({
              paperOnlyTokens: [42, 'BTC'],
              paperOnlyRoutes: ['r1'],
            }),
          }),
      });

      const svc = mkService(mkRepo());
      const filters = await svc.fetchPaperOnlyFilters();
      const tokenKeys = filters.map((f) => f.tokenKey);
      expect(tokenKeys).toContain('42');
      expect(tokenKeys).toContain('BTC');
    });
  });

  describe('runDiscoveryCycle', () => {
    it('returns zeroed result when discovery is disabled', async () => {
      process.env.PAPER_DISCOVERY_ENABLED = 'false';
      const svc = mkService(mkRepo());

      const result = await svc.runDiscoveryCycle();

      expect(result).toEqual({
        candidatesFound: 0,
        candidatesEligible: 0,
        candidatesProcessed: 0,
        error: null,
      });
    });

    it('returns zeroed result when no fresh snapshots are available', async () => {
      // No MARKET_INTAKE_SERVICE_URL -> fetchFreshSnapshots returns []
      const svc = mkService(mkRepo());

      const result = await svc.runDiscoveryCycle();

      expect(result.candidatesFound).toBe(0);
      expect(result.candidatesEligible).toBe(0);
      expect(result.candidatesProcessed).toBe(0);
      expect(result.error).toBeNull();
    });

    it('profiles and persists eligible candidates end-to-end', async () => {
      process.env.MARKET_INTAKE_SERVICE_URL = 'http://intake.test';
      process.env.PAPER_DISCOVERY_PAPER_ONLY_TOKENS = 'BTC';
      process.env.PAPER_DISCOVERY_PAPER_ONLY_ROUTES = 'btc-eth-uniswap';
      process.env.PAPER_DISCOVERY_MIN_PROFIT_USD = '0';
      process.env.PAPER_DISCOVERY_MIN_LIQUIDITY_SCORE = '0';

      globalThis.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            items: [
              {
                id: 's-1',
                venueCode: 'binance',
                venueSymbol: 'BTCUSDT',
                instrumentKey: 'BTC',
                routeKey: 'btc-eth-uniswap',
                bid: 100,
                ask: 101,
                observedAt: '2026-07-17T12:00:00.000Z',
                isStale: false,
              },
            ],
          }),
      });

      const created = mkCandidate({
        id: 'c-new',
        is_eligible: true,
        entity_version: 1,
        status: 'discovered',
      });
      // create() dedup pre-check → null; processEligibleCandidate → created
      const findOne = jest.fn().mockImplementation((opts: { where: { id?: string } }) => {
        if (opts.where.id !== undefined) {
          return Promise.resolve(created);
        }
        return Promise.resolve(null);
      });
      const create = jest.fn((values) => ({ ...values }));
      const save = jest.fn().mockResolvedValue(created);
      const emFindOne = jest.fn().mockResolvedValue(created);
      const emSave = jest.fn().mockResolvedValue(
        mkCandidate({ status: 'processed', entity_version: 2 }),
      );
      const transaction = jest.fn(
        async (cb: (em: EntityManager) => Promise<unknown>) =>
          cb({
            findOne: emFindOne,
            save: emSave,
          } as unknown as EntityManager),
      );

      const svc = mkService(
        mkRepo({ findOne, create, save, manager: { transaction } }),
      );

      const result = await svc.runDiscoveryCycle();

      expect(result.candidatesFound).toBe(1);
      expect(result.candidatesEligible).toBe(1);
      expect(result.candidatesProcessed).toBe(1);
      expect(result.error).toBeNull();
      expect(auditMock.appendEntry).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'paper_discovery_cycle_completed',
        }),
      );
    });

    it('records failed cycle audit when persisting throws', async () => {
      process.env.MARKET_INTAKE_SERVICE_URL = 'http://intake.test';
      process.env.PAPER_DISCOVERY_PAPER_ONLY_TOKENS = 'BTC';
      process.env.PAPER_DISCOVERY_PAPER_ONLY_ROUTES = 'btc-eth-uniswap';
      process.env.PAPER_DISCOVERY_MIN_PROFIT_USD = '0';
      process.env.PAPER_DISCOVERY_MIN_LIQUIDITY_SCORE = '0';

      globalThis.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            items: [
              {
                id: 's-1',
                venueCode: 'binance',
                venueSymbol: 'BTCUSDT',
                instrumentKey: 'BTC',
                routeKey: 'btc-eth-uniswap',
                bid: 100,
                ask: 101,
                observedAt: '2026-07-17T12:00:00.000Z',
                isStale: false,
              },
            ],
          }),
      });

      // Force create() to throw a non-QueryFailedError
      const findOne = jest.fn().mockResolvedValue(null);
      const save = jest.fn().mockRejectedValue(new Error('db down'));

      const svc = mkService(
        mkRepo({ findOne, create: jest.fn((v) => v), save }),
      );

      const result = await svc.runDiscoveryCycle();

      expect(result.candidatesFound).toBe(0);
      expect(result.error).toBe('db down');
      expect(auditMock.appendEntry).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'paper_discovery_cycle_failed',
        }),
      );
    });

    it('records failed cycle audit with non-Error error value', async () => {
      process.env.MARKET_INTAKE_SERVICE_URL = 'http://intake.test';
      process.env.PAPER_DISCOVERY_PAPER_ONLY_TOKENS = 'BTC';
      process.env.PAPER_DISCOVERY_PAPER_ONLY_ROUTES = 'btc-eth-uniswap';

      globalThis.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            items: [
              {
                id: 's-1',
                venueCode: 'binance',
                venueSymbol: 'BTCUSDT',
                instrumentKey: 'BTC',
                routeKey: 'btc-eth-uniswap',
                bid: 100,
                ask: 101,
                observedAt: '2026-07-17T12:00:00.000Z',
                isStale: false,
              },
            ],
          }),
      });

      const findOne = jest.fn().mockResolvedValue(null);
      const save = jest.fn().mockRejectedValue('string-err');  

      const svc = mkService(
        mkRepo({ findOne, create: jest.fn((v) => v), save }),
      );

      const result = await svc.runDiscoveryCycle();

      expect(result.error).toBe('string-err');
    });

    it('skips ineligible candidates during processing', async () => {
      process.env.MARKET_INTAKE_SERVICE_URL = 'http://intake.test';
      process.env.PAPER_DISCOVERY_PAPER_ONLY_TOKENS = 'BTC';
      process.env.PAPER_DISCOVERY_PAPER_ONLY_ROUTES = 'btc-eth-uniswap';
      process.env.PAPER_DISCOVERY_MIN_PROFIT_USD = '100'; // forces ineligible

      globalThis.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            items: [
              {
                id: 's-1',
                venueCode: 'binance',
                venueSymbol: 'BTCUSDT',
                instrumentKey: 'BTC',
                routeKey: 'btc-eth-uniswap',
                bid: 100,
                ask: 101,
                observedAt: '2026-07-17T12:00:00.000Z',
                isStale: false,
              },
            ],
          }),
      });

      const created = mkCandidate({ id: 'c-new', is_eligible: false });
      const findOne = jest.fn().mockResolvedValue(null);
      const save = jest.fn().mockResolvedValue(created);
      const transaction = jest.fn();

      const svc = mkService(
        mkRepo({ findOne, create: jest.fn((v) => v), save, manager: { transaction } }),
      );

      const result = await svc.runDiscoveryCycle();

      expect(result.candidatesFound).toBe(1);
      expect(result.candidatesEligible).toBe(0);
      expect(result.candidatesProcessed).toBe(0);
      // processEligibleCandidate not called for ineligible candidate
      expect(transaction).not.toHaveBeenCalled();
    });

    it('swallows audit failure in success path (cycle still returns success)', async () => {
      process.env.MARKET_INTAKE_SERVICE_URL = 'http://intake.test';
      process.env.PAPER_DISCOVERY_PAPER_ONLY_TOKENS = 'BTC';
      process.env.PAPER_DISCOVERY_PAPER_ONLY_ROUTES = 'btc-eth-uniswap';
      process.env.PAPER_DISCOVERY_MIN_PROFIT_USD = '0';
      process.env.PAPER_DISCOVERY_MIN_LIQUIDITY_SCORE = '0';

      globalThis.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            items: [
              {
                id: 's-1',
                venueCode: 'binance',
                venueSymbol: 'BTCUSDT',
                instrumentKey: 'BTC',
                routeKey: 'btc-eth-uniswap',
                bid: 100,
                ask: 101,
                observedAt: '2026-07-17T12:00:00.000Z',
                isStale: false,
              },
            ],
          }),
      });

      // Audit always rejects
      const appendEntry = jest.fn().mockRejectedValue(new Error('audit down'));
      const svc = new PaperDiscoveryService(
        mkRepo({
          findOne: jest.fn().mockResolvedValue(null),
          create: jest.fn((v) => v),
          save: jest.fn().mockResolvedValue(
            mkCandidate({ id: 'c-new', is_eligible: false }),
          ),
        }) as unknown as CandidateRepo,
        {} as Repository<PaperTradeEntity>,
        { appendEntry } as unknown as AuditClientService,
      );

      const result = await svc.runDiscoveryCycle();
      // Wait for swallowed audit promise
      await new Promise((r) => setImmediate(r));

      expect(result.error).toBeNull();
      expect(appendEntry).toHaveBeenCalled();
    });

    it('swallows audit failure in failure path (cycle still returns error)', async () => {
      process.env.MARKET_INTAKE_SERVICE_URL = 'http://intake.test';
      process.env.PAPER_DISCOVERY_PAPER_ONLY_TOKENS = 'BTC';
      process.env.PAPER_DISCOVERY_PAPER_ONLY_ROUTES = 'btc-eth-uniswap';
      process.env.PAPER_DISCOVERY_MIN_PROFIT_USD = '0';
      process.env.PAPER_DISCOVERY_MIN_LIQUIDITY_SCORE = '0';

      globalThis.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            items: [
              {
                id: 's-1',
                venueCode: 'binance',
                venueSymbol: 'BTCUSDT',
                instrumentKey: 'BTC',
                routeKey: 'btc-eth-uniswap',
                bid: 100,
                ask: 101,
                observedAt: '2026-07-17T12:00:00.000Z',
                isStale: false,
              },
            ],
          }),
      });

      // Audit always rejects; save also throws → cycle failure path
      const appendEntry = jest.fn().mockRejectedValue(new Error('audit down'));
      const svc = new PaperDiscoveryService(
        mkRepo({
          findOne: jest.fn().mockResolvedValue(null),
          create: jest.fn((v) => v),
          save: jest.fn().mockRejectedValue(new Error('db down')),
        }) as unknown as CandidateRepo,
        {} as Repository<PaperTradeEntity>,
        { appendEntry } as unknown as AuditClientService,
      );

      const result = await svc.runDiscoveryCycle();
      // Wait for swallowed audit promise
      await new Promise((r) => setImmediate(r));

      expect(result.error).toBe('db down');
      expect(appendEntry).toHaveBeenCalled();
    });
  });
});
