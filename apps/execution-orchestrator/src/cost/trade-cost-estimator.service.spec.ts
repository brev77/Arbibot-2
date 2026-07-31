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

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TradeCostEstimatorService,
        { provide: GasEstimatorService, useValue: gasEstimator },
        { provide: SlippageProtectionService, useValue: slippageProtection },
        { provide: PoolDiscoveryService, useValue: poolDiscovery },
        { provide: PriceOracleService, useValue: priceOracle },
        { provide: DexRiskPolicyService, useValue: dexRiskPolicy },
        { provide: BridgeAdapterFactoryService, useValue: bridgeAdapterFactory },
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
});
