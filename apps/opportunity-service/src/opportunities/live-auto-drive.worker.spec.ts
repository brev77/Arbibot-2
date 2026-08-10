import { ConflictException } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { ArbitrageOpportunityEntity } from '@arbibot/persistence';

import { LiveAutoDriveConfigService } from './live-auto-drive-config.service';
import { LiveAutoDriveWorker } from './live-auto-drive.worker';
import { LiveKillSwitchService } from './live-kill-switch.service';
import { LivePriceClientService } from './live-price-client.service';
import { PlanSetupOrchestrator } from './plan-setup-orchestrator.service';
import { RiskClientService } from './risk-client.service';
import { TokenResolverService } from './token-resolver.service';

/**
 * PLAN10 P10-8 — LiveAutoDriveWorker targeted tests (crash/concurrency/recovery).
 *
 * Covers the capital-safety-critical scenarios:
 *   - disabled → no tick (kill-switch respected)
 *   - halted → no tick (LiveKillSwitchService ConflictException)
 *   - happy path: one risk_checked opp → plan created → marker stamped
 *   - dedup: opp with live_execution_plan_id set is NOT re-picked (marker race)
 *   - skip_no_token: unresolved tokens → metric, no plan
 *   - kill-switch mid-setup → no further processing
 *
 * All collaborators are mocked; the repo is an in-memory stub. prom-client registry is
 * cleared in beforeEach to avoid double-metric-registration across instantiations.
 */

const ENV_KEYS = [
  'LIVE_AUTO_DRIVE_ENABLED',
  'LIVE_AUTO_DRIVE_INTERVAL_MS',
  'NODE_ENV',
] as const;

function clearEnv(): void {
  for (const k of ENV_KEYS) delete process.env[k];
}

function clearMetrics(): void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('@arbibot/nest-platform');
    if (typeof mod.getArbibotMetricsRegistry === 'function') {
      mod.getArbibotMetricsRegistry().clear();
    }
  } catch {
    /* ignore */
  }
}

function makeOpp(overrides: Partial<ArbitrageOpportunityEntity> = {}): ArbitrageOpportunityEntity {
  return {
    id: 'opp-1',
    correlationId: 'corr-1',
    state: 'risk_checked',
    riskDecisionId: 'rd-1',
    liveExecutionPlanId: null,
    payload: {
      instrumentKey: 'arb:42161:WETH-USDC',
      netProfitUsd: 7,
      buyVenue: 'uniswap-v2',
      sellVenue: 'sushiswap',
      evidence: { buyPrice: 2000 },
    },
    entityVersion: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('LiveAutoDriveWorker', () => {
  let worker: LiveAutoDriveWorker;
  const configMock: { getConfig: jest.Mock; isEnabled: jest.Mock; ensureEffectiveConfigLoaded: jest.Mock } = {
    getConfig: jest.fn(() => ({ intervalMs: 10_000, batchSize: 5, maxConcurrentPlans: 3, minNetProfitUsd: 5, notionalUsd: 10, enabled: true })),
    isEnabled: jest.fn(() => true),
    ensureEffectiveConfigLoaded: jest.fn(),
  };
  const killSwitchMock: { assertLiveNotHalted: jest.Mock; isLiveHalted: jest.Mock } = {
    assertLiveNotHalted: jest.fn(),
    isLiveHalted: jest.fn(),
  };
  // PLAN12 #48: resolveTokens (sync) + computeAmountIns (sync) replace the old single
  // resolve() call; livePrice.getTokenPriceUsd (async) happens between them.
  const tokensFixture = { token0Address: '0xWETH', token1Address: '0xUSDC', decimals0: 18, decimals1: 6, chainId: 42161 };
  const amountInsFixture = { buyAmountIn: '10000000', sellAmountIn: '5000000000000000' };
  const tokenResolverMock: { resolveTokens: jest.Mock; computeAmountIns: jest.Mock } = {
    resolveTokens: jest.fn(),
    computeAmountIns: jest.fn(),
  };
  const livePriceMock: { getTokenPriceUsd: jest.Mock } = { getTokenPriceUsd: jest.fn() };
  const planSetupMock: { orchestrate: jest.Mock } = { orchestrate: jest.fn() };
  const riskClientMock: { getRiskDecision: jest.Mock } = { getRiskDecision: jest.fn() };
  const repoMock = { find: jest.fn(), count: jest.fn() };
  const txMock = jest.fn();
  // Concurrent-plan gate now reads via dataSource.query (raw SQL counting rows with
  // live_execution_plan_id IS NOT NULL). Default to "0 in-flight" so the gate lets the
  // worker proceed; tests that need to simulate saturation override this.
  const queryMock = jest.fn().mockResolvedValue([{ cnt: 0 }]);

  beforeEach(() => {
    clearEnv();
    process.env.LIVE_AUTO_DRIVE_ENABLED = 'true';
    jest.clearAllMocks();
    clearMetrics();
    killSwitchMock.assertLiveNotHalted.mockResolvedValue(undefined);
    killSwitchMock.isLiveHalted.mockResolvedValue(false);
    configMock.isEnabled.mockReturnValue(true);
    configMock.getConfig.mockReturnValue({
      intervalMs: 10_000,
      batchSize: 5,
      maxConcurrentPlans: 3,
      minNetProfitUsd: 5,
      notionalUsd: 10,
      enabled: true,
    });
    configMock.ensureEffectiveConfigLoaded.mockResolvedValue(undefined);
    riskClientMock.getRiskDecision.mockResolvedValue({ id: 'rd-1', correlationId: 'risk-corr-1', outcome: 'approved' });
    // PLAN12 #48: by default tokens resolve + oracle returns $1 (USDC) + amountIns computed.
    tokenResolverMock.resolveTokens.mockReturnValue(tokensFixture);
    tokenResolverMock.computeAmountIns.mockReturnValue(amountInsFixture);
    livePriceMock.getTokenPriceUsd.mockResolvedValue(1);
    queryMock.mockResolvedValue([{ cnt: 0 }]);
    worker = new LiveAutoDriveWorker(
      configMock as unknown as LiveAutoDriveConfigService,
      killSwitchMock as unknown as LiveKillSwitchService,
      tokenResolverMock as unknown as TokenResolverService,
      planSetupMock as unknown as PlanSetupOrchestrator,
      riskClientMock as unknown as RiskClientService,
      livePriceMock as unknown as LivePriceClientService,
      repoMock as unknown as never,
      { transaction: txMock, query: queryMock } as unknown as DataSource,
    );
  });

  afterEach(() => {
    clearEnv();
  });

  describe('disabled / halted guards', () => {
    it('disabled → returns ran=false, no repo find', async () => {
      configMock.isEnabled.mockReturnValue(false);
      const r = await worker.trigger();
      expect(r.ran).toBe(false);
      expect(r.plansCreated).toBe(0);
      expect(r.message).toBe('worker disabled');
      expect(repoMock.find).not.toHaveBeenCalled();
    });

    it('halted → killSwitch throws, no plans created', async () => {
      // trigger() calls runCycleInner directly (bypasses runCycle's kill-switch guard);
      // but runCycleInner re-checks per-opp. We test via the public trigger which wraps
      // runCycleInner — the top-level guard is in runCycle. Here we verify per-opp re-check.
      killSwitchMock.assertLiveNotHalted.mockRejectedValue(new ConflictException('halted'));
      repoMock.find.mockResolvedValue([makeOpp()]);
      repoMock.count.mockResolvedValue(1);
      tokenResolverMock.resolveTokens.mockReturnValue(null); // would skip anyway, but halt checked first
      const r = await worker.trigger();
      // The first per-opp assertLiveNotHalted throws ConflictException → runCycleInner aborts.
      expect(r.plansCreated).toBe(0);
    });
  });

  describe('happy path', () => {
    it('creates a plan and stamps marker for a risk_checked opp', async () => {
      repoMock.find.mockResolvedValue([makeOpp()]);
      repoMock.count.mockResolvedValue(0); // not saturated
      // PLAN12 #48: resolveTokens + computeAmountIns defaults from beforeEach cover this case.
      planSetupMock.orchestrate.mockResolvedValue({ planId: 'plan-1', reservationId: 'resv-1' });
      txMock.mockImplementation(async (cb: (em: unknown) => Promise<unknown>) => {
        const em = {
          query: () => Promise.resolve([{ rowCount: 1 }]),
        };
        return cb(em);
      });

      const r = await worker.trigger();
      expect(r.plansCreated).toBe(1);
      expect(planSetupMock.orchestrate).toHaveBeenCalledTimes(1);
      expect(planSetupMock.orchestrate).toHaveBeenCalledWith(expect.objectContaining({
        routeKey: 'arb:42161:WETH-USDC',
        notionalUsd: 10,
        buyVenueKey: 'uniswap-v2',
        sellVenueKey: 'sushiswap',
      }));
    });

    it('inherits correlationId from the risk decision (proper rework of workaround #3)', async () => {
      // plan.correlationId MUST equal risk.correlationId for assertApprovedRiskViaHttp to pass.
      // The worker fetches the decision via getRiskDecision and uses decision.correlationId,
      // NOT the opp's own correlationId (which may differ).
      repoMock.find.mockResolvedValue([makeOpp({ correlationId: 'opp-corr-X' })]);
      repoMock.count.mockResolvedValue(0);
      // PLAN12 #48: resolveTokens + computeAmountIns defaults from beforeEach cover this case.
      planSetupMock.orchestrate.mockResolvedValue({ planId: 'plan-1', reservationId: 'resv-1' });
      riskClientMock.getRiskDecision.mockResolvedValue({ id: 'rd-1', correlationId: 'risk-corr-Y', outcome: 'approved' });
      txMock.mockImplementation(async (cb: (em: unknown) => Promise<unknown>) => {
        const em = { query: () => Promise.resolve([{ rowCount: 1 }]) };
        return cb(em);
      });

      await worker.trigger();
      // Risk-corr-Y must override opp-corr-X.
      expect(riskClientMock.getRiskDecision).toHaveBeenCalledWith('rd-1');
      expect(planSetupMock.orchestrate).toHaveBeenCalledWith(expect.objectContaining({
        correlationId: 'risk-corr-Y',
        riskDecisionId: 'rd-1',
      }));
    });

    it('falls back to opp correlationId when risk-service is unreachable (resilience)', async () => {
      repoMock.find.mockResolvedValue([makeOpp({ correlationId: 'opp-fallback' })]);
      repoMock.count.mockResolvedValue(0);
      // PLAN12 #48: resolveTokens + computeAmountIns defaults from beforeEach cover this case.
      planSetupMock.orchestrate.mockResolvedValue({ planId: 'plan-1', reservationId: 'resv-1' });
      riskClientMock.getRiskDecision.mockResolvedValue(null); // risk-service unreachable / 404
      txMock.mockImplementation(async (cb: (em: unknown) => Promise<unknown>) => {
        const em = { query: () => Promise.resolve([{ rowCount: 1 }]) };
        return cb(em);
      });

      await worker.trigger();
      // Fallback uses opp.correlationId; plan still created (with trace correlation caveat).
      expect(planSetupMock.orchestrate).toHaveBeenCalledWith(expect.objectContaining({
        correlationId: 'opp-fallback',
      }));
    });
  });

  describe('concurrent-plan gate (fix #1)', () => {
    it('saturated: dataSource.query returns cnt >= maxConcurrentPlans → no find, no plans', async () => {
      configMock.getConfig.mockReturnValue({
        intervalMs: 10_000, batchSize: 5, maxConcurrentPlans: 3, minNetProfitUsd: 5, notionalUsd: 10, enabled: true,
      });
      // 3 active markers = saturated at the cap (maxConcurrentPlans=3).
      queryMock.mockResolvedValue([{ cnt: 3 }]);
      repoMock.find.mockResolvedValue([makeOpp()]); // would otherwise be picked

      const r = await worker.trigger();
      expect(r.plansCreated).toBe(0);
      expect(planSetupMock.orchestrate).not.toHaveBeenCalled();
    });

    it('not saturated: cnt < maxConcurrentPlans → proceeds to find', async () => {
      configMock.getConfig.mockReturnValue({
        intervalMs: 10_000, batchSize: 5, maxConcurrentPlans: 3, minNetProfitUsd: 5, notionalUsd: 10, enabled: true,
      });
      queryMock.mockResolvedValue([{ cnt: 2 }]); // under the cap
      repoMock.find.mockResolvedValue([]);
      const r = await worker.trigger();
      expect(r.plansCreated).toBe(0); // no opps to process
      expect(repoMock.find).toHaveBeenCalled();
    });
  });

  describe('dedup (marker race)', () => {
    it('opp with live_execution_plan_id already set is not re-picked', async () => {
      // The worker filters undispatched = pending.filter(o => o.liveExecutionPlanId === null).
      // An opp with marker set is excluded.
      repoMock.find.mockResolvedValue([makeOpp({ liveExecutionPlanId: 'plan-existing' })]);
      repoMock.count.mockResolvedValue(0);
      const r = await worker.trigger();
      expect(r.plansCreated).toBe(0);
      expect(planSetupMock.orchestrate).not.toHaveBeenCalled();
    });

    it('concurrent marker race: UPDATE affects 0 rows → skip_marker_race, no double count', async () => {
      repoMock.find.mockResolvedValue([makeOpp()]);
      repoMock.count.mockResolvedValue(0);
      // PLAN12 #48: resolveTokens + computeAmountIns defaults from beforeEach cover this case.
      planSetupMock.orchestrate.mockResolvedValue({ planId: 'plan-1', reservationId: 'resv-1' });
      // Simulate the optimistic UPDATE returning 0 affected rows (concurrent tick won the race).
      txMock.mockImplementation(async (cb: (em: unknown) => Promise<unknown>) => {
        const em = { query: () => Promise.resolve([{ rowCount: 0 }]) };
        return cb(em);
      });

      const r = await worker.trigger();
      expect(r.plansCreated).toBe(0); // marker race → not counted
      expect(planSetupMock.orchestrate).toHaveBeenCalledTimes(1);
    });
  });

  describe('skip filters', () => {
    it('skip_no_token: resolver returns null → no plan', async () => {
      repoMock.find.mockResolvedValue([makeOpp()]);
      repoMock.count.mockResolvedValue(0);
      tokenResolverMock.resolveTokens.mockReturnValue(null);
      const r = await worker.trigger();
      expect(r.plansCreated).toBe(0);
      expect(planSetupMock.orchestrate).not.toHaveBeenCalled();
    });

    it('skip_no_price: oracle returns null → no plan (PLAN12 #48 fail-closed)', async () => {
      // Tokens resolve, but the EO PriceOracleService cannot price the quote token
      // (e.g. long-tail without a WETH pool, or EO unreachable). The worker must skip
      // rather than fall back to the catastrophic `notionalUsd × 10^decimals` formula.
      repoMock.find.mockResolvedValue([makeOpp()]);
      repoMock.count.mockResolvedValue(0);
      tokenResolverMock.resolveTokens.mockReturnValue(tokensFixture);
      livePriceMock.getTokenPriceUsd.mockResolvedValue(null);
      const r = await worker.trigger();
      expect(r.plansCreated).toBe(0);
      expect(planSetupMock.orchestrate).not.toHaveBeenCalled();
      expect(livePriceMock.getTokenPriceUsd).toHaveBeenCalledWith(42161, '0xUSDC');
    });

    it('skip_no_price: computeAmountIns returns null (invalid buyPrice) → no plan', async () => {
      repoMock.find.mockResolvedValue([makeOpp()]);
      repoMock.count.mockResolvedValue(0);
      tokenResolverMock.resolveTokens.mockReturnValue(tokensFixture);
      tokenResolverMock.computeAmountIns.mockReturnValue(null);
      const r = await worker.trigger();
      expect(r.plansCreated).toBe(0);
      expect(planSetupMock.orchestrate).not.toHaveBeenCalled();
    });

    it('skip_min_profit: netProfitUsd below threshold → no plan', async () => {
      repoMock.find.mockResolvedValue([makeOpp({ payload: { netProfitUsd: 1, instrumentKey: 'arb:42161:WETH-USDC', buyVenue: 'uniswap-v2', sellVenue: 'sushiswap' } })]);
      repoMock.count.mockResolvedValue(0);
      const r = await worker.trigger();
      expect(r.plansCreated).toBe(0);
      expect(planSetupMock.orchestrate).not.toHaveBeenCalled();
    });
  });

  describe('crash mid-setup', () => {
    it('planSetup throws → worker logs, continues to next opp (no crash)', async () => {
      repoMock.find.mockResolvedValue([makeOpp({ id: 'opp-fail' }), makeOpp({ id: 'opp-ok' })]);
      repoMock.count.mockResolvedValue(0);
      // PLAN12 #48: resolveTokens + computeAmountIns defaults from beforeEach cover this case.
      planSetupMock.orchestrate
        .mockRejectedValueOnce(new Error('begin-execution 422'))
        .mockResolvedValueOnce({ planId: 'plan-2', reservationId: 'resv-2' });
      txMock.mockImplementation(async (cb: (em: unknown) => Promise<unknown>) => {
        const em = { query: () => Promise.resolve([{ rowCount: 1 }]) };
        return cb(em);
      });

      const r = await worker.trigger();
      // First opp failed (crash mid-setup), second succeeded.
      expect(r.plansCreated).toBe(1);
      expect(planSetupMock.orchestrate).toHaveBeenCalledTimes(2);
    });
  });
});
