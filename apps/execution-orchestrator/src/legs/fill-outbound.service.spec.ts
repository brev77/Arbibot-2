import { FillOutboundService } from './fill-outbound.service';
import type { PlansService } from '../plans/plans.service';

describe('FillOutboundService', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.EXECUTION_SETTLEMENT_SIMULATE_PORTFOLIO_FAILURE_ON_LEG_INDEXES;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('does nothing when settlement is disabled', async () => {
    process.env.EXECUTION_SETTLEMENT_ENABLED = 'false';
    delete process.env.PORTFOLIO_SERVICE_URL;
    delete process.env.PORTFOLIO_API_BASE;
    const tryMark = jest.fn();
    const svc = new FillOutboundService({ tryMarkPlanCompletedWhenAllLegsFilled: tryMark } as unknown as PlansService);
    await svc.afterLegFullyFilled({
      planId: '00000000-0000-4000-8000-000000000001',
      legId: '00000000-0000-4000-8000-000000000002',
      legIndex: 0,
      filledQuantity: 1,
      instrumentKey: 'k',
      correlationId: null,
    });
    expect(tryMark).not.toHaveBeenCalled();
  });

  it('throws when settlement is enabled but portfolio base URL is missing', async () => {
    process.env.EXECUTION_SETTLEMENT_ENABLED = 'true';
    delete process.env.PORTFOLIO_SERVICE_URL;
    delete process.env.PORTFOLIO_API_BASE;
    const svc = new FillOutboundService({
      tryMarkPlanCompletedWhenAllLegsFilled: jest.fn(),
    } as unknown as PlansService);
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
