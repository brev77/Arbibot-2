import { FillOutboundService } from './fill-outbound.service';
import type { PlansService } from '../plans/plans.service';
import type { PriceOracleService } from '../execution/price/price-oracle.service';

describe('FillOutboundService', () => {
  const originalEnv = process.env;

  // D4-B-3-CEILING: FillOutboundService now needs a PriceOracleService to price
  // fills into USD notional. Mock both methods it touches.
  const mockPriceOracle = {
    getTokenPriceUsd: jest.fn().mockResolvedValue(2500),
    getTokenDecimals: jest.fn().mockResolvedValue(18),
  } as unknown as PriceOracleService;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.EXECUTION_SETTLEMENT_SIMULATE_PORTFOLIO_FAILURE_ON_LEG_INDEXES;
    jest.clearAllMocks();
    (mockPriceOracle.getTokenPriceUsd as jest.Mock) = jest.fn().mockResolvedValue(2500);
    (mockPriceOracle.getTokenDecimals as jest.Mock) = jest.fn().mockResolvedValue(18);
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('marks plan completed when all legs filled, even when settlement is disabled', async () => {
    process.env.EXECUTION_SETTLEMENT_ENABLED = 'false';
    delete process.env.PORTFOLIO_SERVICE_URL;
    delete process.env.PORTFOLIO_API_BASE;
    const tryMark = jest.fn().mockResolvedValue({ completed: true, plan: null });
    const svc = new FillOutboundService(
      { tryMarkPlanCompletedWhenAllLegsFilled: tryMark } as unknown as PlansService,
      mockPriceOracle,
    );
    await svc.afterLegFullyFilled({
      planId: '00000000-0000-4000-8000-000000000001',
      legId: '00000000-0000-4000-8000-000000000002',
      legIndex: 0,
      filledQuantity: 1,
      instrumentKey: 'k',
      correlationId: null,
    });
    expect(tryMark).toHaveBeenCalledWith('00000000-0000-4000-8000-000000000001');
  });

  it('throws when settlement is enabled but portfolio base URL is missing', async () => {
    process.env.EXECUTION_SETTLEMENT_ENABLED = 'true';
    delete process.env.PORTFOLIO_SERVICE_URL;
    delete process.env.PORTFOLIO_API_BASE;
    const svc = new FillOutboundService(
      {
        tryMarkPlanCompletedWhenAllLegsFilled: jest.fn().mockResolvedValue({ completed: false, plan: null }),
      } as unknown as PlansService,
      mockPriceOracle,
    );
    await expect(
      svc.afterLegFullyFilled({
        planId: '00000000-0000-4000-8000-000000000001',
        legId: '00000000-0000-4000-8000-000000000002',
        legIndex: 0,
        filledQuantity: 1,
        instrumentKey: 'k',
        correlationId: null,
      }),
    ).rejects.toThrow(/PORTFOLIO_SERVICE_URL|PORTFOLIO_API_BASE/);
  });
});
