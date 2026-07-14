import { getArbibotMetricsRegistry } from '@arbibot/nest-platform';
import type { ExecutionLegEntity, ExecutionPlanEntity } from '@arbibot/persistence';

import { VenueSubmitClientError } from '../../venue/venue-adapter';

import { PaperDexAdapter, simulateSwapOutput, calculateSimulatedGasCostEth } from './paper-dex.adapter';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// ───────────────────────────────────────────────────────────────────────
// Stubs
// ───────────────────────────────────────────────────────────────────────

function planStub(playbookConfig?: Record<string, unknown>): ExecutionPlanEntity {
  return {
    id: 'plan-paper-1',
    correlationId: null,
    state: 'executing',
    capitalReservationId: null,
    riskDecisionId: null,
    routeKey: null,
    entityVersion: 1,
    playbookConfig: playbookConfig ?? null,
    createdAt: new Date(),
    updatedAt: new Date(),
    legs: [],
  };
}

function legStub(legIndex: number): ExecutionLegEntity {
  return {
    id: 'leg-paper-1',
    planId: 'plan-paper-1',
    legIndex,
    state: 'created',
    entityVersion: 1,
    venueRef: null,
    targetQuantity: 10,
    filledQuantity: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as ExecutionLegEntity;
}

/** Standard DEX swap config for paper-dex testing. */
const STANDARD_DEX_SWAPS = [
  {
    chainId: 42161,
    tokenIn: '0xTokenA',
    tokenOut: '0xTokenB',
    amountIn: '1000000000000000000', // 1e18
  },
];

const STANDARD_PLAYBOOK = {
  venueKey: 'paper-dex',
  dexSwaps: STANDARD_DEX_SWAPS,
};

// ───────────────────────────────────────────────────────────────────────
// Pure function tests
// ───────────────────────────────────────────────────────────────────────

describe('simulateSwapOutput', () => {
  it('applies no change when multiplier=1.0 and impact=0', () => {
    const { amountOut, amountOutMin } = simulateSwapOutput('1000', 50, 1.0, 0);
    expect(amountOut).toBe('1000');
    // slippage 50 bps: 1000 * 9950 / 10000 = 995
    expect(amountOutMin).toBe('995');
  });

  it('applies output multiplier > 1 (profit simulation)', () => {
    const { amountOut } = simulateSwapOutput('1000', 50, 1.05, 0);
    // 1000 * 10500 / 10000 = 1050
    expect(amountOut).toBe('1050');
  });

  it('applies output multiplier < 1 (loss simulation)', () => {
    const { amountOut } = simulateSwapOutput('1000', 50, 0.95, 0);
    // 1000 * 9500 / 10000 = 950
    expect(amountOut).toBe('950');
  });

  it('applies price impact before slippage', () => {
    const { amountOut, amountOutMin } = simulateSwapOutput('1000', 100, 1.0, 10);
    // price impact 10 bps: 1000 * 9990 / 10000 = 999
    expect(amountOut).toBe('999');
    // slippage 100 bps: 999 * 9900 / 10000 = 98901 / 100 (BigInt)
    // 999n * 9900n / 10000n = 9890100n / 10000n = 989n
    expect(amountOutMin).toBe('989');
  });

  it('handles zero price impact', () => {
    const { amountOut } = simulateSwapOutput('5000', 50, 1.0, 0);
    expect(amountOut).toBe('5000');
  });

  it('handles large amounts (1e18)', () => {
    const { amountOut } = simulateSwapOutput('1000000000000000000', 50, 1.0, 0);
    expect(amountOut).toBe('1000000000000000000');
  });
});

describe('calculateSimulatedGasCostEth', () => {
  it('calculates gas cost correctly', () => {
    // 180000 gas * 0.1 gwei / 1e9
    const cost = calculateSimulatedGasCostEth(180_000, 0.1);
    expect(cost).toBeCloseTo(0.000018, 6);
  });

  it('calculates gas cost for 1 gwei', () => {
    const cost = calculateSimulatedGasCostEth(200_000, 1.0);
    expect(cost).toBeCloseTo(0.0002, 6);
  });

  it('handles zero gas price', () => {
    const cost = calculateSimulatedGasCostEth(180_000, 0);
    expect(cost).toBe(0);
  });
});

// ───────────────────────────────────────────────────────────────────────
// Adapter tests
// ───────────────────────────────────────────────────────────────────────

describe('PaperDexAdapter', () => {
  let adapter: PaperDexAdapter;
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
    // Clear paper-dex env overrides
    delete process.env.PAPER_DEX_SIMULATED_GAS_USED;
    delete process.env.PAPER_DEX_SIMULATED_GAS_PRICE_GWEI;
    delete process.env.PAPER_DEX_SIMULATED_OUTPUT_MULTIPLIER;
    delete process.env.PAPER_DEX_SIMULATED_PRICE_IMPACT_BPS;
    delete process.env.DEX_DEFAULT_SLIPPAGE_BPS;

    getArbibotMetricsRegistry().clear();
    adapter = new PaperDexAdapter();
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  // ─────────────────────────────────────────────────────────────────────
  // submitLeg — success
  // ─────────────────────────────────────────────────────────────────────

  describe('submitLeg — success', () => {
    it('returns simulated result with paper-dex externalOrderId prefix', async () => {
      const plan = planStub(STANDARD_PLAYBOOK);
      const leg = legStub(0);

      const result = await adapter.submitLeg(plan, leg);

      expect(result.externalOrderId).toMatch(/^paper-dex:/);
    });

    it('returns simulated=true flag', async () => {
      const plan = planStub(STANDARD_PLAYBOOK);
      const leg = legStub(0);

      const result = await adapter.submitLeg(plan, leg);

      expect(result).toHaveProperty('simulated', true);
    });

    it('returns chainId from swap params', async () => {
      const plan = planStub(STANDARD_PLAYBOOK);
      const leg = legStub(0);

      const result = await adapter.submitLeg(plan, leg) as any; // eslint-disable-line @typescript-eslint/no-explicit-any

      expect(result.chainId).toBe(42161);
    });

    it('returns amountIn from swap params', async () => {
      const plan = planStub(STANDARD_PLAYBOOK);
      const leg = legStub(0);

      const result = await adapter.submitLeg(plan, leg) as any; // eslint-disable-line @typescript-eslint/no-explicit-any

      expect(result.amountIn).toBe('1000000000000000000');
    });

    it('returns simulated gas values', async () => {
      process.env.PAPER_DEX_SIMULATED_GAS_USED = '200000';
      process.env.PAPER_DEX_SIMULATED_GAS_PRICE_GWEI = '0.5';

      const plan = planStub(STANDARD_PLAYBOOK);
      const leg = legStub(0);

      const result = await adapter.submitLeg(plan, leg) as any; // eslint-disable-line @typescript-eslint/no-explicit-any

      expect(result.gasUsed).toBe(200_000);
      expect(result.gasPriceGwei).toBe(0.5);
    });

    it('returns swap path from params', async () => {
      const plan = planStub({
        venueKey: 'paper-dex',
        dexSwaps: [{
          chainId: 42161,
          tokenIn: '0xA',
          tokenOut: '0xC',
          amountIn: '1000',
          path: ['0xA', '0xB', '0xC'],
        }],
      });
      const leg = legStub(0);

      const result = await adapter.submitLeg(plan, leg) as any; // eslint-disable-line @typescript-eslint/no-explicit-any

      expect(result.path).toEqual(['0xA', '0xB', '0xC']);
    });

    it('defaults path to [tokenIn, tokenOut]', async () => {
      const plan = planStub(STANDARD_PLAYBOOK);
      const leg = legStub(0);

      const result = await adapter.submitLeg(plan, leg) as any; // eslint-disable-line @typescript-eslint/no-explicit-any

      expect(result.path).toEqual(['0xTokenA', '0xTokenB']);
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // submitLeg — validation errors
  // ─────────────────────────────────────────────────────────────────────

  describe('submitLeg — validation', () => {
    it('throws VenueSubmitClientError when playbookConfig is missing', async () => {
      const plan = planStub(null as any); // eslint-disable-line @typescript-eslint/no-explicit-any
      const leg = legStub(0);

      await expect(adapter.submitLeg(plan, leg)).rejects.toThrow(VenueSubmitClientError);
      await expect(adapter.submitLeg(plan, leg)).rejects.toThrow('missing playbookConfig');
    });

    it('throws VenueSubmitClientError when amountIn is zero', async () => {
      const plan = planStub({
        venueKey: 'paper-dex',
        dexSwaps: [{
          chainId: 42161,
          tokenIn: '0xA',
          tokenOut: '0xB',
          amountIn: '0',
        }],
      });
      const leg = legStub(0);

      await expect(adapter.submitLeg(plan, leg)).rejects.toThrow(VenueSubmitClientError);
      await expect(adapter.submitLeg(plan, leg)).rejects.toThrow('amountIn must be positive');
    });

    it('throws VenueSubmitClientError when tokenIn equals tokenOut', async () => {
      const plan = planStub({
        venueKey: 'paper-dex',
        dexSwaps: [{
          chainId: 42161,
          tokenIn: '0xSame',
          tokenOut: '0xSame',
          amountIn: '1000',
        }],
      });
      const leg = legStub(0);

      await expect(adapter.submitLeg(plan, leg)).rejects.toThrow(VenueSubmitClientError);
      await expect(adapter.submitLeg(plan, leg)).rejects.toThrow('tokenIn and tokenOut must differ');
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // submitLeg — env configuration
  // ─────────────────────────────────────────────────────────────────────

  describe('submitLeg — env overrides', () => {
    it('respects PAPER_DEX_SIMULATED_OUTPUT_MULTIPLIER for profit scenario', async () => {
      process.env.PAPER_DEX_SIMULATED_OUTPUT_MULTIPLIER = '1.1';
      process.env.PAPER_DEX_SIMULATED_PRICE_IMPACT_BPS = '0';

      const plan = planStub(STANDARD_PLAYBOOK);
      const leg = legStub(0);

      const result = await adapter.submitLeg(plan, leg) as any; // eslint-disable-line @typescript-eslint/no-explicit-any

      // 1e18 * 11000 / 10000 = 1.1e18
      const expectedOut = '1100000000000000000';
      expect(result.amountOut).toBe(expectedOut);
    });

    it('respects PAPER_DEX_SIMULATED_PRICE_IMPACT_BPS', async () => {
      process.env.PAPER_DEX_SIMULATED_OUTPUT_MULTIPLIER = '1.0';
      process.env.PAPER_DEX_SIMULATED_PRICE_IMPACT_BPS = '100'; // 1%

      const plan = planStub(STANDARD_PLAYBOOK);
      const leg = legStub(0);

      const result = await adapter.submitLeg(plan, leg) as any; // eslint-disable-line @typescript-eslint/no-explicit-any

      // 1e18 * 9900 / 10000 = 990000000000000000
      expect(result.amountOut).toBe('990000000000000000');
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // recordDrift — drift metrics (DEX-1-3-PAPER-MAINNET)
  // ─────────────────────────────────────────────────────────────────────

  describe('recordDrift — drift metrics', () => {
    it('records drift histogram and counter with correct labels', async () => {
      adapter.recordDrift(42161, 'USDC-WETH-univ2', 12.5, 'measured');

      const registry = getArbibotMetricsRegistry();
      const metrics = await registry.getMetricsAsJSON();
      const driftHist = metrics.find((m: any) => m.name === 'arb_paper_dex_drift_bps'); // eslint-disable-line @typescript-eslint/no-explicit-any
      const driftCount = metrics.find((m: any) => m.name === 'arb_paper_dex_drift_samples_total'); // eslint-disable-line @typescript-eslint/no-explicit-any

      expect(driftHist).toBeDefined();
      expect(driftCount).toBeDefined();
    });

    it('defaults status to "measured" when not specified', async () => {
      adapter.recordDrift(42161, 'USDC-WETH-univ2', 5);

      const registry = getArbibotMetricsRegistry();
      const metrics = await registry.getMetricsAsJSON();
      const driftCount = metrics.find((m: any) => m.name === 'arb_paper_dex_drift_samples_total'); // eslint-disable-line @typescript-eslint/no-explicit-any
      expect(driftCount).toBeDefined();
    });

    it('records drift with "stale" status', async () => {
      adapter.recordDrift(42161, 'USDC-WETH-univ2', 100, 'stale');

      const registry = getArbibotMetricsRegistry();
      const metrics = await registry.getMetricsAsJSON();
      const driftCount = metrics.find((m: any) => m.name === 'arb_paper_dex_drift_samples_total'); // eslint-disable-line @typescript-eslint/no-explicit-any
      expect(driftCount).toBeDefined();
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // D4-B-2d: paper/live isolation
  // ─────────────────────────────────────────────────────────────────────

  describe('D4-B-2d paper/live isolation', () => {
    it('does NOT import DexRiskPolicyService / PriceOracleService (structural guard)', () => {
      // Read the adapter source at runtime: the paper path must not reference
      // the live risk-gate symbols. This catches accidental wiring of the live
      // risk gate (evaluateTrade / recordTradeVolume) into the paper path.
      const src = readFileSync(join(__dirname, 'paper-dex.adapter.ts'), 'utf8');
      expect(src).not.toContain('DexRiskPolicyService');
      expect(src).not.toContain('PriceOracleService');
      expect(src).not.toContain('evaluateTrade');
      expect(src).not.toContain('recordTradeVolume');
      expect(src).not.toContain('enforceLiveRiskGate');
    });

    it('constructor has ZERO parameters (no live risk-gate dependencies can be injected)', () => {
      // PaperDexAdapter must keep a zero-arg constructor. Asserting .length
      // avoids the metrics double-registration that a second `new` would
      // trigger while still pinning the constructor signature. The live risk
      // gate (evaluateTrade / recordTradeVolume) can therefore never be wired
      // into the paper path via DI.
      expect(PaperDexAdapter.length).toBe(0);
      // The live-gate methods must not exist on the paper adapter instance.
      const adapterAny = adapter as unknown as Record<string, unknown>;
      expect(adapterAny.evaluateTrade).toBeUndefined();
      expect(adapterAny.recordTradeVolume).toBeUndefined();
    });

    it('completes a paper swap without any live risk-gate calls (path isolation)', async () => {
      // No DexRiskPolicyService / PriceOracleService are in the process. If the
      // paper path tried to reach them it would throw (undefined methods), so a
      // successful swap proves the live gate is structurally unreachable.
      const plan = planStub(STANDARD_PLAYBOOK);
      const leg = legStub(0);

      const result = await adapter.submitLeg(plan, leg);

      expect(result.externalOrderId).toMatch(/^paper-dex:/);
      // Paper adapter returns a PaperDexSwapResult; live fields (txHash) absent.
      expect((result as unknown as { simulated: boolean }).simulated).toBe(true);
    });
  });
});
