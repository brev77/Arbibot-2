/* eslint-disable @typescript-eslint/no-explicit-any */
import { Test, TestingModule } from '@nestjs/testing';
import { getArbibotMetricsRegistry } from '@arbibot/nest-platform';

import { TradeCostEstimatorService } from './trade-cost-estimator.service';
import { GasEstimatorService } from '../execution/gas/gas-estimator.service';
import { SlippageProtectionService } from '../execution/slippage/slippage-protection.service';
import { PoolDiscoveryService } from '../execution/pool/pool-discovery.service';
import { PriceOracleService } from '../execution/price/price-oracle.service';
import { DexRiskPolicyService } from '../execution/risk/dex-risk-policy.service';
import { BridgeAdapterFactoryService } from '../execution/bridge/bridge-adapter-factory.service';
import { V3QuoterService } from '../execution/v3-quoter.service';

// Clear metrics registry between tests (matches other spec patterns).
function clearRegistry(): void {
  try {
    getArbibotMetricsRegistry().clear();
  } catch {
    /* already cleared */
  }
}

const CHAIN = 42161 as never;
const TOKEN_IN = '0x0000000000000000000000000000000000000001' as never;
const TOKEN_OUT = '0x0000000000000000000000000000000000000002' as never;

function makePlan(overrides: Partial<{
  id: string;
  playbookConfig: Record<string, unknown> | null;
}> = {}): any {
  return {
    id: overrides.id ?? 'plan-cost-001',
    playbookConfig: overrides.playbookConfig === null
      ? null
      : (overrides.playbookConfig ?? {
          schemaVersion: 1,
          grossProfitUsd: 10,
          legs: [
            {
              legIndex: 0,
              legType: 'dex',
              chainId: CHAIN,
              venueKey: 'uniswap-v2',
              tokenIn: TOKEN_IN,
              tokenOut: TOKEN_OUT,
              amountIn: '1000000',
              slippageBps: 50,
            },
          ],
          isCrossChain: false,
          chainIds: [CHAIN],
        }),
  };
}

describe('TradeCostEstimatorService', () => {
  let service: TradeCostEstimatorService;
  let gasEstimator: { estimateGas: jest.Mock; getEip1559FeeData: jest.Mock; estimateGasCostUsd: jest.Mock };
  let slippageProtection: { estimateSlippage: jest.Mock };
  let poolDiscovery: { getCachedPools: jest.Mock };
  let priceOracle: { getNativeUsdPrice: jest.Mock; getTokenPriceUsd: jest.Mock; getTokenDecimals: jest.Mock };
  let dexRiskPolicy: { getEffectiveConfig: jest.Mock };
  let bridgeAdapterFactory: { hasAdapter: jest.Mock; resolveAdapter: jest.Mock };
  let v3Quoter: { quoteExactInputSingle: jest.Mock };

  beforeEach(async () => {
    clearRegistry();

    gasEstimator = {
      estimateGas: jest.fn().mockResolvedValue({
        gasLimit: 200_000n,
        feeData: {
          maxFeePerGas: 1_000_000_000n,
          maxPriorityFeePerGas: 100_000_000n,
          baseFee: 900_000_000n,
          maxFeePerGasGwei: '1.0',
          maxPriorityFeePerGasGwei: '0.1',
          baseFeeGwei: '0.9',
        },
        estimatedCostWei: 200_000_000_000n,
        estimatedCostEth: '0.0002',
        withinPolicy: true,
      }),
      getEip1559FeeData: jest.fn().mockResolvedValue({
        maxFeePerGas: 1_000_000_000n,
        maxPriorityFeePerGas: 100_000_000n,
        baseFee: 900_000_000n,
        maxFeePerGasGwei: '1.0',
        maxPriorityFeePerGasGwei: '0.1',
        baseFeeGwei: '0.9',
      }),
      // 200k gas × 1 gwei × $2500/ETH ≈ $0.5
      estimateGasCostUsd: jest.fn().mockReturnValue({ costUsd: 0.5, nativeUsdPrice: 2500, costNative: 0.0002 }),
    };
    slippageProtection = {
      estimateSlippage: jest.fn().mockReturnValue({
        estimatedBps: 30,
        maxAcceptableBps: 100,
        poolImpactBps: 30,
        priceImpactBps: 10,
        isAcceptable: true,
        recommendation: 'proceed',
      }),
    };
    poolDiscovery = { getCachedPools: jest.fn().mockReturnValue([]) };
    priceOracle = {
      getNativeUsdPrice: jest.fn().mockResolvedValue(2500),
      getTokenPriceUsd: jest.fn().mockResolvedValue(1),
      getTokenDecimals: jest.fn().mockResolvedValue(6),
    };
    dexRiskPolicy = {
      getEffectiveConfig: jest.fn().mockResolvedValue({
        enabled: false,
        maxSlippageBps: 50,
        maxPositionSizeUsd: 500,
        minPoolLiquidityUsd: 50_000,
        maxGasPriceGwei: 30,
        allowedProtocols: ['uniswap-v2'],
        blockedTokens: [],
        maxDailyVolumeUsd: 5_000,
        requireApproval: true,
        minNetProfitUsd: 0.5,
      }),
    };
    bridgeAdapterFactory = { hasAdapter: jest.fn().mockReturnValue(false), resolveAdapter: jest.fn() };
    v3Quoter = { quoteExactInputSingle: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TradeCostEstimatorService,
        { provide: GasEstimatorService, useValue: gasEstimator },
        { provide: SlippageProtectionService, useValue: slippageProtection },
        { provide: PoolDiscoveryService, useValue: poolDiscovery },
        { provide: PriceOracleService, useValue: priceOracle },
        { provide: DexRiskPolicyService, useValue: dexRiskPolicy },
        { provide: BridgeAdapterFactoryService, useValue: bridgeAdapterFactory },
        { provide: V3QuoterService, useValue: v3Quoter },
      ],
    }).compile();

    service = module.get(TradeCostEstimatorService);
  });

  afterEach(() => {
    clearRegistry();
  });

  describe('estimatePlanCost', () => {
    it('estimates DEX leg cost (gas + slippage + pool fee) from a cached pool', async () => {
      // Provide a cached pool so slippage + pool fee are computed (not modeled).
      const pool = {
        address: '0xpool',
        token0: TOKEN_IN,
        token1: TOKEN_OUT,
        feeBps: 30,
        reserve0: 1_000_000_000_000n,
        reserve1: 1_000_000_000_000n,
        chainId: CHAIN,
        factory: '0x',
        protocol: 'uniswap-v2',
        blockNumber: 1,
        discoveredAt: new Date(),
      };
      poolDiscovery.getCachedPools.mockReturnValue([pool]);
      // notional: 1e6 / 1e6 = 1 token × $1 = $1
      const breakdown = await service.estimatePlanCost(makePlan());

      expect(breakdown.legs).toHaveLength(1);
      const leg = breakdown.legs[0]!;
      expect(leg.legType).toBe('dex');
      expect(leg.gasUsd).toBe(0.5);
      // slippageCost = notional($1) × priceImpactBps(10) / 10000 = 0.001
      expect(leg.slippageCostUsd).toBeCloseTo(0.001, 5);
      // poolFee = notional($1) × feeBps(30) / 10000 = 0.003
      expect(leg.poolFeeUsd).toBeCloseTo(0.003, 5);
      expect(leg.bridgeFeeUsd).toBe(0);
      expect(leg.totalCostUsd).toBeGreaterThan(0);
      expect(breakdown.totalGasUsd).toBe(0.5);
    });

    it('falls back to modeled slippage when pool is not cached', async () => {
      poolDiscovery.getCachedPools.mockReturnValue([]);
      const breakdown = await service.estimatePlanCost(makePlan());

      const leg = breakdown.legs[0]!;
      // Without a pool, slippage is modeled from leg bps (50) × notional, pool
      // fee is 0 (unknown tier), and confidence downgrades to 'modeled'.
      expect(leg.slippageCostUsd).toBeCloseTo(0.005, 5); // 50 bps × $1 / 10000
      expect(leg.poolFeeUsd).toBe(0);
      expect(leg.estimateConfidence).toBe('modeled');
      expect(breakdown.estimateConfidence).toBe('modeled');
    });

    it('computes net profit = gross − total cost', async () => {
      const breakdown = await service.estimatePlanCost(makePlan());
      expect(breakdown.grossProfitUsd).toBe(10);
      expect(breakdown.netProfitUsd).not.toBeNull();
      expect(breakdown.netProfitUsd).toBeCloseTo(10 - breakdown.totalCostUsd, 5);
    });

    it('returns null net profit when gross is unknown', async () => {
      const breakdown = await service.estimatePlanCost(
        makePlan({ playbookConfig: { schemaVersion: 1, legs: [] } }),
      );
      expect(breakdown.grossProfitUsd).toBeNull();
      expect(breakdown.netProfitUsd).toBeNull();
    });
  });

  describe('estimatePlanCost — fail-closed on unavailable native price', () => {
    it('marks DEX leg unavailable when native USD price is null', async () => {
      priceOracle.getNativeUsdPrice.mockResolvedValue(null);
      const breakdown = await service.estimatePlanCost(makePlan());

      const leg = breakdown.legs[0]!;
      expect(leg.gasUsd).toBe(0);
      expect(leg.estimateConfidence).toBe('unavailable');
      expect(breakdown.estimateConfidence).toBe('unavailable');
    });
  });

  describe('evaluatePlanGate', () => {
    it('allows a profitable plan', async () => {
      const breakdown = await service.estimatePlanCost(makePlan());
      // gross $10, total cost ~$0.5 → net ~$9.5 > minNetProfit $0.5
      const decision = await service.evaluatePlanGate(breakdown);
      expect(decision.allowed).toBe(true);
      expect(decision.reasons).toHaveLength(0);
    });

    it('blocks when net profit is below the configured floor', async () => {
      // gross $0.1, total cost ~$0.5 → net negative, below floor $0.5.
      const breakdown = await service.estimatePlanCost(
        makePlan({ playbookConfig: { schemaVersion: 1, grossProfitUsd: 0.1, legs: [
          { legIndex: 0, legType: 'dex', chainId: CHAIN, tokenIn: TOKEN_IN, tokenOut: TOKEN_OUT, amountIn: '1000000', slippageBps: 50 },
        ] } }),
      );
      const decision = await service.evaluatePlanGate(breakdown);
      expect(decision.allowed).toBe(false);
      expect(decision.reasons.some((r) => r.includes('below minimum'))).toBe(true);
    });

    it('blocks (fail-closed) when confidence is unavailable', async () => {
      priceOracle.getNativeUsdPrice.mockResolvedValue(null);
      const breakdown = await service.estimatePlanCost(makePlan());
      const decision = await service.evaluatePlanGate(breakdown);
      expect(decision.allowed).toBe(false);
      expect(decision.reasons.some((r) => r.includes('unavailable'))).toBe(true);
    });

    it('warns (non-blocking) when confidence is modeled', async () => {
      poolDiscovery.getCachedPools.mockReturnValue([]);
      const breakdown = await service.estimatePlanCost(makePlan());
      const decision = await service.evaluatePlanGate(breakdown);
      expect(decision.allowed).toBe(true);
      expect(decision.warnings.some((w) => w.includes('modeled'))).toBe(true);
    });
  });

  // ── FIX-F (2026-08-11): V3 pools use QuoterV2, not constant-product. ──
  describe('estimatePlanCost — V3 slippage (FIX-F)', () => {
    const Q96 = 1n << 96n; // sqrtPriceX96 = 2^96 → spot price 1:1 (token1/token0)
    // At 1:1 spot, fairAmountOut for token0→token1 = amountIn exactly.

    function makeV3Plan(overrides: { amountIn?: string; fee?: number; grossProfitUsd?: number } = {}): any {
      return {
        id: 'plan-v3-001',
        playbookConfig: {
          schemaVersion: 1,
          grossProfitUsd: overrides.grossProfitUsd ?? 10,
          legs: [
            {
              legIndex: 0,
              legType: 'dex',
              chainId: CHAIN,
              venueKey: 'uniswap-v3',
              tokenIn: TOKEN_IN,
              tokenOut: TOKEN_OUT,
              amountIn: overrides.amountIn ?? '1000000',
              slippageBps: 50,
              fee: overrides.fee ?? 3000,
            },
          ],
          isCrossChain: false,
          chainIds: [CHAIN],
        },
      };
    }

    it('uses the authoritative QuoterV2 quote for V3 slippage (not constant-product)', async () => {
      const pool = {
        address: '0xv3pool',
        token0: TOKEN_IN,
        token1: TOKEN_OUT,
        feeBps: 30, // fee tier 3000 → 30 bps
        reserve0: 9_000_000_000_000_000n, // V3: == liquidity, MUST be ignored
        reserve1: 9_000_000_000_000_000n,
        sqrtPriceX96: Q96, // spot price 1:1
        chainId: CHAIN,
        factory: '0x',
        protocol: 'uniswap-v3',
        blockNumber: 1,
        discoveredAt: new Date(),
      };
      poolDiscovery.getCachedPools.mockReturnValue([pool]);
      // Real quote returns 990000 for 1000000 in → 1% impact = 100 bps.
      v3Quoter.quoteExactInputSingle.mockResolvedValue(990_000n);

      const breakdown = await service.estimatePlanCost(makeV3Plan());
      const leg = breakdown.legs[0]!;

      expect(v3Quoter.quoteExactInputSingle).toHaveBeenCalledTimes(1);
      expect(v3Quoter.quoteExactInputSingle).toHaveBeenCalledWith(
        CHAIN, TOKEN_IN, TOKEN_OUT, 1_000_000n, 3000,
      );
      // impact 100 bps: notional $1 (1e6 units / 1e6 dec × $1) → slippage $0.01
      expect(leg.slippageBps).toBe(100);
      expect(leg.slippageCostUsd).toBeCloseTo(0.01, 5);
      // pool fee from the V3 pool tier (30 bps × $1 / 10000 = $0.003)
      expect(leg.poolFeeUsd).toBeCloseTo(0.003, 5);
      // V2 constant-product must NOT have been consulted for a V3 leg.
      expect(slippageProtection.estimateSlippage).not.toHaveBeenCalled();
      expect(leg.estimateConfidence).toBe('exact');
    });

    it('falls back to modeled slippage when the V3 quote is unavailable', async () => {
      const pool = {
        address: '0xv3pool',
        token0: TOKEN_IN,
        token1: TOKEN_OUT,
        feeBps: 30,
        reserve0: 1n,
        reserve1: 1n,
        sqrtPriceX96: Q96,
        chainId: CHAIN,
        factory: '0x',
        protocol: 'uniswap-v3',
        blockNumber: 1,
        discoveredAt: new Date(),
      };
      poolDiscovery.getCachedPools.mockReturnValue([pool]);
      v3Quoter.quoteExactInputSingle.mockResolvedValue(null); // RPC fail / unsupported

      const breakdown = await service.estimatePlanCost(makeV3Plan());
      const leg = breakdown.legs[0]!;

      // Modeled: leg.slippageBps (50) × notional, pool fee still from the tier.
      expect(leg.slippageCostUsd).toBeCloseTo(0.005, 5); // 50 bps × $1
      expect(leg.estimateConfidence).toBe('modeled');
      // Broken constant-product estimate must never run on a V3 leg.
      expect(slippageProtection.estimateSlippage).not.toHaveBeenCalled();
    });

    // FIX-E (2026-08-11): findPoolForLeg must pick the pool matching the leg's
    // fee tier, not the first cached pool.
    it('FIX-E: selects the fee-matching pool, not a thin pool of another tier', async () => {
      const thin = {
        address: '0xthin',
        token0: TOKEN_IN,
        token1: TOKEN_OUT,
        feeBps: 5, // fee tier 500 → thin
        reserve0: 5_000n,
        reserve1: 5_000n,
        sqrtPriceX96: Q96,
        chainId: CHAIN,
        factory: '0x',
        protocol: 'uniswap-v3',
        blockNumber: 1,
        discoveredAt: new Date(),
      };
      const liquid = {
        address: '0xliquid',
        token0: TOKEN_IN,
        token1: TOKEN_OUT,
        feeBps: 30, // fee tier 3000 → liquid, the tier the leg uses
        reserve0: 90_000_000_000_000_000n,
        reserve1: 90_000_000_000_000_000n,
        sqrtPriceX96: Q96,
        chainId: CHAIN,
        factory: '0x',
        protocol: 'uniswap-v3',
        blockNumber: 1,
        discoveredAt: new Date(),
      };
      // Thin first in the cache — legacy first-match would have picked it.
      poolDiscovery.getCachedPools.mockReturnValue([thin, liquid]);
      v3Quoter.quoteExactInputSingle.mockResolvedValue(990_000n);

      const breakdown = await service.estimatePlanCost(makeV3Plan({ fee: 3000 }));
      const leg = breakdown.legs[0]!;

      // poolFeeUsd must reflect fee tier 3000 (feeBps 30), proving the liquid
      // pool was selected — a thin-fee (5 bps) selection would give $0.0005.
      expect(leg.poolFeeUsd).toBeCloseTo(0.003, 5); // 30 bps × $1
    });

    it('FIX-E: returns no pool when the requested fee tier is absent (modeled path)', async () => {
      const thin = {
        address: '0xthin',
        token0: TOKEN_IN,
        token1: TOKEN_OUT,
        feeBps: 5, // only fee tier 500 cached
        reserve0: 5_000n,
        reserve1: 5_000n,
        sqrtPriceX96: Q96,
        chainId: CHAIN,
        factory: '0x',
        protocol: 'uniswap-v3',
        blockNumber: 1,
        discoveredAt: new Date(),
      };
      poolDiscovery.getCachedPools.mockReturnValue([thin]);
      // leg asks for fee 3000 which is NOT cached → modeled, quoter untouched.
      const breakdown = await service.estimatePlanCost(makeV3Plan({ fee: 3000 }));
      const leg = breakdown.legs[0]!;

      expect(v3Quoter.quoteExactInputSingle).not.toHaveBeenCalled();
      expect(leg.estimateConfidence).toBe('modeled');
    });
  });
});
