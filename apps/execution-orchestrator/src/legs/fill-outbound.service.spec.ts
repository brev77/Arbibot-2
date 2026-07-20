import { FillOutboundService } from './fill-outbound.service';
import type { PlansService } from '../plans/plans.service';
import type { PriceOracleService } from '../execution/price/price-oracle.service';

/**
 * FillOutboundService spec — post-commit settlement (portfolio HTTP +
 * capital release) gated by EXECUTION_SETTLEMENT_ENABLED.
 *
 * Pattern: direct instantiation with stub PlansService + PriceOracleService
 * and `globalThis.fetch` mocked per-test.
 */
describe('FillOutboundService', () => {
  const originalEnv = process.env;
  const origFetch = globalThis.fetch;

  const mockPriceOracle = {
    getTokenPriceUsd: jest.fn(),
    getTokenDecimals: jest.fn(),
  } as unknown as PriceOracleService;

  const baseArgs = {
    planId: '00000000-0000-4000-8000-000000000001',
    legId: '00000000-0000-4000-8000-000000000002',
    legIndex: 0,
    filledQuantity: 5,
    instrumentKey: 'k',
    correlationId: null as string | null,
  };

  function makeService(
    plansOverrides: Partial<PlansService> = {},
  ): FillOutboundService {
    return new FillOutboundService(
      {
        tryMarkPlanCompletedWhenAllLegsFilled: jest
          .fn()
          .mockResolvedValue({ completed: false, plan: null }),
        ...plansOverrides,
      } as unknown as PlansService,
      mockPriceOracle,
    );
  }

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.EXECUTION_SETTLEMENT_ENABLED;
    delete process.env.EXECUTION_SETTLEMENT_SIMULATE_PORTFOLIO_FAILURE_ON_LEG_INDEXES;
    delete process.env.PORTFOLIO_SERVICE_URL;
    delete process.env.PORTFOLIO_API_BASE;
    delete process.env.CAPITAL_SERVICE_URL;
    delete process.env.CAPITAL_SERVICE_BASE_URL;
    jest.clearAllMocks();
    (mockPriceOracle.getTokenPriceUsd as jest.Mock).mockResolvedValue(2500);
    (mockPriceOracle.getTokenDecimals as jest.Mock).mockResolvedValue(18);
    globalThis.fetch = origFetch;
  });

  afterAll(() => {
    process.env = originalEnv;
    globalThis.fetch = origFetch;
  });

  describe('afterLegFullyFilled', () => {
    it('marks plan completed even when settlement is disabled', async () => {
      process.env.EXECUTION_SETTLEMENT_ENABLED = 'false';
      const tryMark = jest.fn().mockResolvedValue({ completed: true, plan: null });
      const svc = new FillOutboundService(
        { tryMarkPlanCompletedWhenAllLegsFilled: tryMark } as unknown as PlansService,
        mockPriceOracle,
      );

      await svc.afterLegFullyFilled(baseArgs);

      expect(tryMark).toHaveBeenCalledWith(baseArgs.planId);
    });

    it('throws when settlement enabled but portfolio base URL is missing', async () => {
      process.env.EXECUTION_SETTLEMENT_ENABLED = 'true';
      const svc = makeService();

      await expect(svc.afterLegFullyFilled(baseArgs)).rejects.toThrow(
        /PORTFOLIO_SERVICE_URL|PORTFOLIO_API_BASE/,
      );
    });

    it('posts portfolio confirm-fill on happy path', async () => {
      process.env.EXECUTION_SETTLEMENT_ENABLED = 'true';
      process.env.PORTFOLIO_SERVICE_URL = 'http://portfolio.test/';
      const fetchMock = jest.fn().mockResolvedValue({ ok: true, text: () => Promise.resolve('') });
      globalThis.fetch = fetchMock;

      const svc = makeService();
      await svc.afterLegFullyFilled(baseArgs);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toMatch(/^http:\/\/portfolio\.test\//);
      expect(init?.method).toBe('POST');
      const body = JSON.parse(init?.body as string);
      expect(body.planId).toBe(baseArgs.planId);
      expect(body.idempotencyKey).toBe(`portfolio:fill:${baseArgs.legId}`);
      expect(body.notionalUsd).toBe('0'); // no chainId/tokenIn → notional '0'
    });

    it('sends x-correlation-id header when args.correlationId is set', async () => {
      process.env.EXECUTION_SETTLEMENT_ENABLED = 'true';
      process.env.PORTFOLIO_SERVICE_URL = 'http://portfolio.test';
      const fetchMock = jest.fn().mockResolvedValue({ ok: true, text: () => Promise.resolve('') });
      globalThis.fetch = fetchMock;

      const svc = makeService();
      await svc.afterLegFullyFilled({ ...baseArgs, correlationId: 'corr-1' });

      const init = fetchMock.mock.calls[0][1] as RequestInit;
      const headers = init.headers as Record<string, string>;
      expect(headers['x-correlation-id']).toBe('corr-1');
    });

    it('throws when portfolio responds non-2xx', async () => {
      process.env.EXECUTION_SETTLEMENT_ENABLED = 'true';
      process.env.PORTFOLIO_SERVICE_URL = 'http://portfolio.test';
      globalThis.fetch = jest
        .fn()
        .mockResolvedValue({ ok: false, status: 500, text: () => Promise.resolve('boom') });

      const svc = makeService();
      await expect(svc.afterLegFullyFilled(baseArgs)).rejects.toThrow(/Portfolio confirm-fill failed/);
    });

    it('retries transient HTTP statuses (429, 502, 503, 504) then succeeds', async () => {
      process.env.EXECUTION_SETTLEMENT_ENABLED = 'true';
      process.env.PORTFOLIO_SERVICE_URL = 'http://portfolio.test';
      const fetchMock = jest
        .fn()
        .mockResolvedValueOnce({ ok: false, status: 503, text: () => Promise.resolve('') })
        .mockResolvedValueOnce({ ok: false, status: 429, text: () => Promise.resolve('') })
        .mockResolvedValueOnce({ ok: true, text: () => Promise.resolve('') });
      globalThis.fetch = fetchMock;

      const svc = makeService();
      await svc.afterLegFullyFilled(baseArgs);

      expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it('returns last transient failure response when retries exhaust', async () => {
      process.env.EXECUTION_SETTLEMENT_ENABLED = 'true';
      process.env.PORTFOLIO_SERVICE_URL = 'http://portfolio.test';
      const fetchMock = jest.fn().mockResolvedValue({
        ok: false,
        status: 502,
        text: () => Promise.resolve('bad gateway'),
      });
      globalThis.fetch = fetchMock;

      const svc = makeService();
      await expect(svc.afterLegFullyFilled(baseArgs)).rejects.toThrow(/Portfolio confirm-fill failed/);
      // default retries = 4
      expect(fetchMock).toHaveBeenCalledTimes(4);
    });

    it('does not retry non-transient failure statuses (400)', async () => {
      process.env.EXECUTION_SETTLEMENT_ENABLED = 'true';
      process.env.PORTFOLIO_SERVICE_URL = 'http://portfolio.test';
      const fetchMock = jest.fn().mockResolvedValue({
        ok: false,
        status: 400,
        text: () => Promise.resolve('bad request'),
      });
      globalThis.fetch = fetchMock;

      const svc = makeService();
      await expect(svc.afterLegFullyFilled(baseArgs)).rejects.toThrow(/Portfolio confirm-fill failed/);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('releases capital when plan completed with capitalReservationId', async () => {
      process.env.EXECUTION_SETTLEMENT_ENABLED = 'true';
      process.env.PORTFOLIO_SERVICE_URL = 'http://portfolio.test';
      process.env.CAPITAL_SERVICE_BASE_URL = 'http://capital.test';
      const fetchMock = jest.fn().mockResolvedValue({ ok: true, text: () => Promise.resolve('') });
      globalThis.fetch = fetchMock;

      const svc = new FillOutboundService(
        {
          tryMarkPlanCompletedWhenAllLegsFilled: jest.fn().mockResolvedValue({
            completed: true,
            plan: { capitalReservationId: 'res-1' },
          }),
        } as unknown as PlansService,
        mockPriceOracle,
      );

      await svc.afterLegFullyFilled(baseArgs);

      // Two HTTP calls: portfolio confirm + capital release
      expect(fetchMock).toHaveBeenCalledTimes(2);
      const capitalCall = fetchMock.mock.calls[1];
      expect(capitalCall[0]).toContain('/capital/reservations/res-1/release');
    });

    it('uses CAPITAL_SERVICE_URL when CAPITAL_SERVICE_BASE_URL is unset', async () => {
      process.env.EXECUTION_SETTLEMENT_ENABLED = 'true';
      process.env.PORTFOLIO_SERVICE_URL = 'http://portfolio.test';
      process.env.CAPITAL_SERVICE_URL = 'http://cap.test';
      const fetchMock = jest.fn().mockResolvedValue({ ok: true, text: () => Promise.resolve('') });
      globalThis.fetch = fetchMock;

      const svc = new FillOutboundService(
        {
          tryMarkPlanCompletedWhenAllLegsFilled: jest.fn().mockResolvedValue({
            completed: true,
            plan: { capitalReservationId: 'res-1' },
          }),
        } as unknown as PlansService,
        mockPriceOracle,
      );

      await svc.afterLegFullyFilled(baseArgs);

      const capitalUrl = fetchMock.mock.calls[1][0];
      expect(capitalUrl).toContain('http://cap.test');
    });

    it('defaults capital base URL when both env vars are unset', async () => {
      process.env.EXECUTION_SETTLEMENT_ENABLED = 'true';
      process.env.PORTFOLIO_SERVICE_URL = 'http://portfolio.test';
      const fetchMock = jest.fn().mockResolvedValue({ ok: true, text: () => Promise.resolve('') });
      globalThis.fetch = fetchMock;

      const svc = new FillOutboundService(
        {
          tryMarkPlanCompletedWhenAllLegsFilled: jest.fn().mockResolvedValue({
            completed: true,
            plan: { capitalReservationId: 'res-1' },
          }),
        } as unknown as PlansService,
        mockPriceOracle,
      );

      await svc.afterLegFullyFilled(baseArgs);

      const capitalUrl = fetchMock.mock.calls[1][0];
      expect(capitalUrl).toContain('http://127.0.0.1:3011');
    });

    it('throws when capital release responds non-2xx', async () => {
      process.env.EXECUTION_SETTLEMENT_ENABLED = 'true';
      process.env.PORTFOLIO_SERVICE_URL = 'http://portfolio.test';
      process.env.CAPITAL_SERVICE_URL = 'http://cap.test';
      const fetchMock = jest
        .fn()
        .mockResolvedValueOnce({ ok: true, text: () => Promise.resolve('') }) // portfolio ok
        .mockResolvedValue({ ok: false, status: 500, text: () => Promise.resolve('boom') }); // capital fail
      globalThis.fetch = fetchMock;

      const svc = new FillOutboundService(
        {
          tryMarkPlanCompletedWhenAllLegsFilled: jest.fn().mockResolvedValue({
            completed: true,
            plan: { capitalReservationId: 'res-1' },
          }),
        } as unknown as PlansService,
        mockPriceOracle,
      );

      await expect(svc.afterLegFullyFilled(baseArgs)).rejects.toThrow(/Capital release failed/);
    });

    it('skips capital release when plan is not completed', async () => {
      process.env.EXECUTION_SETTLEMENT_ENABLED = 'true';
      process.env.PORTFOLIO_SERVICE_URL = 'http://portfolio.test';
      const fetchMock = jest.fn().mockResolvedValue({ ok: true, text: () => Promise.resolve('') });
      globalThis.fetch = fetchMock;

      const svc = new FillOutboundService(
        {
          tryMarkPlanCompletedWhenAllLegsFilled: jest.fn().mockResolvedValue({
            completed: false, // not completed
            plan: { capitalReservationId: 'res-1' },
          }),
        } as unknown as PlansService,
        mockPriceOracle,
      );

      await svc.afterLegFullyFilled(baseArgs);

      expect(fetchMock).toHaveBeenCalledTimes(1); // portfolio only
    });

    it('skips capital release when plan.capitalReservationId is null', async () => {
      process.env.EXECUTION_SETTLEMENT_ENABLED = 'true';
      process.env.PORTFOLIO_SERVICE_URL = 'http://portfolio.test';
      const fetchMock = jest.fn().mockResolvedValue({ ok: true, text: () => Promise.resolve('') });
      globalThis.fetch = fetchMock;

      const svc = new FillOutboundService(
        {
          tryMarkPlanCompletedWhenAllLegsFilled: jest.fn().mockResolvedValue({
            completed: true,
            plan: { capitalReservationId: null },
          }),
        } as unknown as PlansService,
        mockPriceOracle,
      );

      await svc.afterLegFullyFilled(baseArgs);

      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('skips capital release when plan.capitalReservationId is empty string', async () => {
      process.env.EXECUTION_SETTLEMENT_ENABLED = 'true';
      process.env.PORTFOLIO_SERVICE_URL = 'http://portfolio.test';
      const fetchMock = jest.fn().mockResolvedValue({ ok: true, text: () => Promise.resolve('') });
      globalThis.fetch = fetchMock;

      const svc = new FillOutboundService(
        {
          tryMarkPlanCompletedWhenAllLegsFilled: jest.fn().mockResolvedValue({
            completed: true,
            plan: { capitalReservationId: '' },
          }),
        } as unknown as PlansService,
        mockPriceOracle,
      );

      await svc.afterLegFullyFilled(baseArgs);

      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('throws simulated portfolio failure when legIndex is in simulate-failure set', async () => {
      process.env.EXECUTION_SETTLEMENT_ENABLED = 'true';
      process.env.EXECUTION_SETTLEMENT_SIMULATE_PORTFOLIO_FAILURE_ON_LEG_INDEXES = '0, 2';
      process.env.PORTFOLIO_SERVICE_URL = 'http://portfolio.test';
      const fetchMock = jest.fn().mockResolvedValue({ ok: true, text: () => Promise.resolve('') });
      globalThis.fetch = fetchMock;

      const svc = makeService();
      await expect(svc.afterLegFullyFilled({ ...baseArgs, legIndex: 0 })).rejects.toThrow(
        /Simulated portfolio confirm-fill failure/,
      );
      // Should throw BEFORE fetch is attempted
      expect(fetchMock).not.toHaveBeenCalled();

      // legIndex=1 should NOT trigger the simulation
      await svc.afterLegFullyFilled({ ...baseArgs, legIndex: 1 });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('parses simulated-failure env ignoring non-numeric entries', async () => {
      process.env.EXECUTION_SETTLEMENT_ENABLED = 'true';
      process.env.EXECUTION_SETTLEMENT_SIMULATE_PORTFOLIO_FAILURE_ON_LEG_INDEXES = 'abc, -1, 5';
      process.env.PORTFOLIO_SERVICE_URL = 'http://portfolio.test';
      const fetchMock = jest.fn().mockResolvedValue({ ok: true, text: () => Promise.resolve('') });
      globalThis.fetch = fetchMock;

      const svc = makeService();
      // legIndex=5 should trigger simulation; only valid non-negative integer kept
      await expect(svc.afterLegFullyFilled({ ...baseArgs, legIndex: 5 })).rejects.toThrow(
        /Simulated portfolio confirm-fill failure/,
      );
    });

    it('ignores empty simulated-failure env', async () => {
      process.env.EXECUTION_SETTLEMENT_ENABLED = 'true';
      process.env.EXECUTION_SETTLEMENT_SIMULATE_PORTFOLIO_FAILURE_ON_LEG_INDEXES = '   ';
      process.env.PORTFOLIO_SERVICE_URL = 'http://portfolio.test';
      const fetchMock = jest.fn().mockResolvedValue({ ok: true, text: () => Promise.resolve('') });
      globalThis.fetch = fetchMock;

      const svc = makeService();
      await svc.afterLegFullyFilled(baseArgs);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });

  describe('priceFillNotional (via confirmPortfolio body)', () => {
    function captureBody(mock: jest.Mock): { notionalUsd: string } {
      const init = mock.mock.calls[0][1] as RequestInit;
      return JSON.parse(init.body as string);
    }

    it('returns "0" when chainId is missing', async () => {
      process.env.EXECUTION_SETTLEMENT_ENABLED = 'true';
      process.env.PORTFOLIO_SERVICE_URL = 'http://portfolio.test';
      const fetchMock = jest.fn().mockResolvedValue({ ok: true, text: () => Promise.resolve('') });
      globalThis.fetch = fetchMock;

      const svc = makeService();
      await svc.afterLegFullyFilled({ ...baseArgs, tokenIn: '0xtoken' }); // no chainId
      expect(captureBody(fetchMock).notionalUsd).toBe('0');
    });

    it('returns "0" when tokenIn is missing', async () => {
      process.env.EXECUTION_SETTLEMENT_ENABLED = 'true';
      process.env.PORTFOLIO_SERVICE_URL = 'http://portfolio.test';
      const fetchMock = jest.fn().mockResolvedValue({ ok: true, text: () => Promise.resolve('') });
      globalThis.fetch = fetchMock;

      const svc = makeService();
      await svc.afterLegFullyFilled({ ...baseArgs, chainId: 1 }); // no tokenIn
      expect(captureBody(fetchMock).notionalUsd).toBe('0');
    });

    it('computes notional from oracle price + decimals', async () => {
      process.env.EXECUTION_SETTLEMENT_ENABLED = 'true';
      process.env.PORTFOLIO_SERVICE_URL = 'http://portfolio.test';
      (mockPriceOracle.getTokenPriceUsd as jest.Mock).mockResolvedValue(2000);
      (mockPriceOracle.getTokenDecimals as jest.Mock).mockResolvedValue(18);
      const fetchMock = jest.fn().mockResolvedValue({ ok: true, text: () => Promise.resolve('') });
      globalThis.fetch = fetchMock;

      const svc = makeService();
      // filledQuantity=5 units, 18 decimals → units = 5 / 1 = 5; notional = 5 * 2000 = 10000
      await svc.afterLegFullyFilled({
        ...baseArgs,
        filledQuantity: 5 * 10 ** 18,
        chainId: 1,
        tokenIn: '0xtoken',
      });

      const notional = captureBody(fetchMock).notionalUsd;
      expect(Number(notional)).toBeGreaterThan(0);
    });

    it('returns "0" when oracle price is null', async () => {
      process.env.EXECUTION_SETTLEMENT_ENABLED = 'true';
      process.env.PORTFOLIO_SERVICE_URL = 'http://portfolio.test';
      (mockPriceOracle.getTokenPriceUsd as jest.Mock).mockResolvedValue(null);
      const fetchMock = jest.fn().mockResolvedValue({ ok: true, text: () => Promise.resolve('') });
      globalThis.fetch = fetchMock;

      const svc = makeService();
      await svc.afterLegFullyFilled({
        ...baseArgs,
        chainId: 1,
        tokenIn: '0xtoken',
      });
      expect(captureBody(fetchMock).notionalUsd).toBe('0');
    });

    it('returns "0" when oracle decimals is null', async () => {
      process.env.EXECUTION_SETTLEMENT_ENABLED = 'true';
      process.env.PORTFOLIO_SERVICE_URL = 'http://portfolio.test';
      (mockPriceOracle.getTokenPriceUsd as jest.Mock).mockResolvedValue(100);
      (mockPriceOracle.getTokenDecimals as jest.Mock).mockResolvedValue(null);
      const fetchMock = jest.fn().mockResolvedValue({ ok: true, text: () => Promise.resolve('') });
      globalThis.fetch = fetchMock;

      const svc = makeService();
      await svc.afterLegFullyFilled({
        ...baseArgs,
        chainId: 1,
        tokenIn: '0xtoken',
      });
      expect(captureBody(fetchMock).notionalUsd).toBe('0');
    });

    it('returns "0" when oracle throws', async () => {
      process.env.EXECUTION_SETTLEMENT_ENABLED = 'true';
      process.env.PORTFOLIO_SERVICE_URL = 'http://portfolio.test';
      (mockPriceOracle.getTokenPriceUsd as jest.Mock).mockRejectedValue(new Error('oracle down'));
      const fetchMock = jest.fn().mockResolvedValue({ ok: true, text: () => Promise.resolve('') });
      globalThis.fetch = fetchMock;

      const svc = makeService();
      await svc.afterLegFullyFilled({
        ...baseArgs,
        chainId: 1,
        tokenIn: '0xtoken',
      });
      expect(captureBody(fetchMock).notionalUsd).toBe('0');
    });

    it('returns "0" when computed notional is non-finite or zero', async () => {
      process.env.EXECUTION_SETTLEMENT_ENABLED = 'true';
      process.env.PORTFOLIO_SERVICE_URL = 'http://portfolio.test';
      (mockPriceOracle.getTokenPriceUsd as jest.Mock).mockResolvedValue(0); // zero price
      (mockPriceOracle.getTokenDecimals as jest.Mock).mockResolvedValue(18);
      const fetchMock = jest.fn().mockResolvedValue({ ok: true, text: () => Promise.resolve('') });
      globalThis.fetch = fetchMock;

      const svc = makeService();
      await svc.afterLegFullyFilled({
        ...baseArgs,
        filledQuantity: 5,
        chainId: 1,
        tokenIn: '0xtoken',
      });
      expect(captureBody(fetchMock).notionalUsd).toBe('0');
    });
  });
});
