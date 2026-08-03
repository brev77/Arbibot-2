/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeEach, afterAll, jest } from '@jest/globals';
import { getArbibotMetricsRegistry } from '@arbibot/nest-platform';

import { UniswapV2Adapter, applySlippage, getSlippageBps, enforcePostQuoteSlippageGate } from './uniswap-v2.adapter';

// ───────────────────────────────────────────────────────────────────────
// Valid Ethereum addresses for ethers.js v6 compatibility
// ───────────────────────────────────────────────────────────────────────

const TOKEN_IN = '0x0000000000000000000000000000000000000001' as any;
const TOKEN_OUT = '0x0000000000000000000000000000000000000002' as any;
const ROUTER = '0x0000000000000000000000000000000000000abc' as any;
const RECIPIENT = '0x0000000000000000000000000000000000000def' as any;
const FROM = '0x1234567890abcdef1234567890abcdef12345678' as any;

// ───────────────────────────────────────────────────────────────────────
// Mocks — typed as Record<string, any> to avoid Jest assignability issues
// ───────────────────────────────────────────────────────────────────────

const mockRpcProviderManager: Record<string, any> = {
  getProvider: jest.fn(),
};

const mockWalletManager: Record<string, any> = {
  selectWallet: jest.fn(),
};

// P9-3: nonce manager pass-through mock — runs the broadcast fn with a dummy
// nonce without acquiring a real per-wallet lock (unit tests don't need serialization).
const mockNonceManager: Record<string, any> = {
  withBroadcastLock: jest.fn((_chainId: number, _address: string, _provider: unknown, fn: (nonce: number) => Promise<unknown>) => fn(0)),
  acquireNextNonce: jest.fn(() => Promise.resolve(0)),
  recordNonceDrift: jest.fn(),
};

const mockGasEstimator: Record<string, any> = {
  estimateGas: jest.fn(),
  // Cost-estimation: gate derives a gas→USD estimate via these two methods.
  getEip1559FeeData: jest.fn<any>().mockResolvedValue({
    maxFeePerGas: 1_000_000_000n, // 1 gwei
    maxPriorityFeePerGas: 100_000_000n,
    baseFee: 900_000_000n,
    maxFeePerGasGwei: '1.0',
    maxPriorityFeePerGasGwei: '0.1',
    baseFeeGwei: '0.9',
  }),
  estimateGasCostUsd: jest.fn<any>().mockReturnValue({ costUsd: 0.2, nativeUsdPrice: 2500, costNative: 0.00008 }),
};

const mockTokenApprove: Record<string, any> = {
  getAllowance: jest.fn(),
  approveToken: jest.fn(),
};

// D4-B-2d: risk-gate + price-oracle mocks. evaluateTrade allowed by default;
// tests override per-case. Price returns a non-null USD value so the gate
// passes; decimals cached by the oracle. `jest.fn<any>()` keeps the resolved
// value loosely typed so defaulting + per-test overrides both compile.
const mockDexRiskPolicy: Record<string, any> = {
  evaluateTrade: jest.fn<any>().mockResolvedValue({
    allowed: true,
    reasons: [],
    warnings: [],
    estimatedSlippageBps: 0,
    estimatedGasCostUsd: 0,
    poolLiquidityUsd: 0,
  }),
  recordTradeVolume: jest.fn<any>().mockResolvedValue(undefined),
  getEffectiveConfig: jest.fn<any>().mockResolvedValue({ maxSlippageBps: 100000, maxOpenPositions: 10, maxTradeSizeUsd: 100000, dailyVolumeLimitUsd: 1000000, allowedProtocols: ['uniswap-v2','uniswap-v3','sushiswap','pancakeswap-v2','biswap'], blockedTokens: [] }),
};

const mockPriceOracle: Record<string, any> = {
  getTokenPriceUsd: jest.fn<any>().mockResolvedValue(2500),
  getTokenDecimals: jest.fn<any>().mockResolvedValue(18),
};

// Helper: create a minimal plan entity
function makePlan(overrides: Partial<{
  id: string;
  playbookConfig: Record<string, unknown> | null;
}> = {}): any {
  return {
    id: overrides.id ?? 'plan-001',
    correlationId: null,
    state: 'armed',
    capitalReservationId: null,
    riskDecisionId: null,
    routeKey: null,
    entityVersion: 1,
    playbookConfig: overrides.playbookConfig === null
      ? null
      : (overrides.playbookConfig ?? {
          dexSwaps: [
            {
              chainId: 42161,
              tokenIn: TOKEN_IN,
              tokenOut: TOKEN_OUT,
              amountIn: '1000000',
              slippageBps: 50,
            },
          ],
        }),
    createdAt: new Date(),
    updatedAt: new Date(),
    legs: [],
  };
}

// Helper: create a minimal leg entity
function makeLeg(overrides: Partial<{ id: string; legIndex: number }> = {}): any {
  return {
    id: overrides.id ?? 'leg-001',
    planId: 'plan-001',
    legIndex: overrides.legIndex ?? 0,
    state: 'created',
    entityVersion: 1,
    venueRef: null,
    targetQuantity: 1,
    filledQuantity: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

// Helper: create mock SelectedWallet
function makeSelectedWallet(address = FROM) {
  const mockWait = jest.fn() as any;
  const mockSendTx = jest.fn() as any;
  mockSendTx.mockResolvedValue({
    hash: '0xTxHash123',
    wait: mockWait,
  });

  return {
    address,
    wallet: {
      address,
      sendTransaction: mockSendTx,
    },
    _mockWait: mockWait,
  };
}

// Helper: create mock provider
function makeMockProvider(): Record<string, any> {
  return {
    getFeeData: jest.fn(),
    getBlock: jest.fn(),
    estimateGas: jest.fn(),
  };
}

// ───────────────────────────────────────────────────────────────────────
// Tests
// ───────────────────────────────────────────────────────────────────────

describe('UniswapV2Adapter', () => {
  let adapter: UniswapV2Adapter;

  beforeEach(() => {
    getArbibotMetricsRegistry().clear();
    jest.clearAllMocks();

    // Restore default risk-gate behaviour (allowed) after clearAllMocks.
    mockDexRiskPolicy.evaluateTrade.mockResolvedValue({
      allowed: true,
      reasons: [],
      warnings: [],
      estimatedSlippageBps: 0,
      estimatedGasCostUsd: 0,
      poolLiquidityUsd: 0,
    });
    mockDexRiskPolicy.recordTradeVolume.mockResolvedValue(undefined);
    mockPriceOracle.getTokenPriceUsd.mockResolvedValue(2500);
    mockPriceOracle.getTokenDecimals.mockResolvedValue(18);

    adapter = new UniswapV2Adapter(
      mockRpcProviderManager as any,
      mockWalletManager as any,
      mockNonceManager as any,
      mockGasEstimator as any,
      mockTokenApprove as any,
      mockDexRiskPolicy as any,
      mockPriceOracle as any,
    );
  });

  // ─────────────────────────────────────────────────────────────────────
  // Pure function tests
  // ─────────────────────────────────────────────────────────────────────

  describe('applySlippage', () => {
    it('should apply 50 bps slippage correctly', () => {
      expect(applySlippage('1000000', 50)).toBe('995000');
    });

    it('should apply 100 bps slippage correctly', () => {
      expect(applySlippage('1000000', 100)).toBe('990000');
    });

    it('should apply 0 bps slippage (no change)', () => {
      expect(applySlippage('1000000', 0)).toBe('1000000');
    });

    it('should handle large numbers', () => {
      const result = applySlippage('1000000000000000000', 50);
      expect(result).toBe('995000000000000000');
    });
  });

  describe('getSlippageBps', () => {
    const originalEnv = process.env.DEX_DEFAULT_SLIPPAGE_BPS;

    afterAll(() => {
      if (originalEnv !== undefined) {
        process.env.DEX_DEFAULT_SLIPPAGE_BPS = originalEnv;
      } else {
        delete process.env.DEX_DEFAULT_SLIPPAGE_BPS;
      }
    });

    it('should return override when provided', () => {
      expect(getSlippageBps(100)).toBe(100);
    });

    it('should return env value when no override', () => {
      process.env.DEX_DEFAULT_SLIPPAGE_BPS = '75';
      expect(getSlippageBps()).toBe(75);
    });

    it('should return default (50) when no override and no env', () => {
      delete process.env.DEX_DEFAULT_SLIPPAGE_BPS;
      expect(getSlippageBps()).toBe(50);
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // buildSwapTxRequest
  // ─────────────────────────────────────────────────────────────────────

  describe('buildSwapTxRequest', () => {
    it('should encode swapExactTokensForTokens calldata', () => {
      const result = adapter.buildSwapTxRequest(
        ROUTER,
        '1000000',
        '990000',
        [TOKEN_IN, TOKEN_OUT],
        RECIPIENT,
        9999999999,
        FROM,
      );

      expect(result.to).toBe(ROUTER);
      expect(result.value).toBe(0n);
      expect(result.from).toBe(FROM);
      // swapExactTokensForTokens selector = 0x38ed1739
      expect(result.data).toContain('38ed1739');
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // submitLeg — validation
  // ─────────────────────────────────────────────────────────────────────

  describe('submitLeg — validation', () => {
    it('should throw when playbookConfig is null', async () => {
      const plan = makePlan({ playbookConfig: null });
      const leg = makeLeg();

      await expect(adapter.submitLeg(plan, leg)).rejects.toThrow('missing playbookConfig');
    });

    it('should throw when neither legs[] nor dexSwaps[] carry swap params', async () => {
      const plan = makePlan({ playbookConfig: { dexSwaps: 'invalid' } });
      const leg = makeLeg();

      await expect(adapter.submitLeg(plan, leg)).rejects.toThrow('no swap params');
    });

    it('should throw when dexSwaps[legIndex] is missing', async () => {
      const plan = makePlan({ playbookConfig: { dexSwaps: [] } });
      const leg = makeLeg({ legIndex: 0 });

      await expect(adapter.submitLeg(plan, leg)).rejects.toThrow('no swap params');
    });

    it('should throw when required fields have wrong types', async () => {
      const plan = makePlan({
        playbookConfig: {
          dexSwaps: [{ chainId: 'not-a-number' }],
        },
      });
      const leg = makeLeg();

      await expect(adapter.submitLeg(plan, leg)).rejects.toThrow('no swap params');
    });

    it('should throw for unsupported chainId', async () => {
      const plan = makePlan({
        playbookConfig: {
          dexSwaps: [{
            chainId: 99999,
            tokenIn: TOKEN_IN,
            tokenOut: TOKEN_OUT,
            amountIn: '1000',
          }],
        },
      });
      const leg = makeLeg();

      mockRpcProviderManager.getProvider.mockReturnValue(makeMockProvider());

      await expect(adapter.submitLeg(plan, leg)).rejects.toThrow('unsupported chainId');
    });

    // ── Multi-leg legs[] shape (D4-B-2c) ──────────────────────────────

    it('should extract swap params from config.legs[legIndex] (multi-leg format)', async () => {
      const plan = makePlan({
        playbookConfig: {
          schemaVersion: 1,
          legs: [{
            legIndex: 0,
            legType: 'dex',
            chainId: 99999,
            venueKey: 'uniswap-v2',
            tokenIn: TOKEN_IN,
            tokenOut: TOKEN_OUT,
            amountIn: '1000',
          }],
        },
      });
      const leg = makeLeg();

      mockRpcProviderManager.getProvider.mockReturnValue(makeMockProvider());

      // chainId 99999 is unsupported — proves the legs[] entry was parsed
      // (tokenIn/tokenOut/amountIn extracted) and reached resolveRouterAddress.
      await expect(adapter.submitLeg(plan, leg)).rejects.toThrow('unsupported chainId');
    });

    it('should fall back to dexSwaps[] when legs[] has no valid entry', async () => {
      const plan = makePlan({
        playbookConfig: {
          legs: [{ legType: 'bridge' }], // no DEX swap fields
          dexSwaps: [{
            chainId: 99999,
            tokenIn: TOKEN_IN,
            tokenOut: TOKEN_OUT,
            amountIn: '1000',
          }],
        },
      });
      const leg = makeLeg();

      mockRpcProviderManager.getProvider.mockReturnValue(makeMockProvider());

      await expect(adapter.submitLeg(plan, leg)).rejects.toThrow('unsupported chainId');
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // ensureApproval
  // ─────────────────────────────────────────────────────────────────────

  describe('ensureApproval', () => {
    const params = {
      chainId: 42161 as any,
      tokenIn: TOKEN_IN,
      tokenOut: TOKEN_OUT,
      amountIn: '1000000',
    };

    it('should skip approval when allowance is sufficient', async () => {
      const wallet = makeSelectedWallet();
      mockTokenApprove.getAllowance.mockResolvedValue(2000000n);

      await adapter.ensureApproval(params, wallet as any, ROUTER);

      expect(mockTokenApprove.approveToken).not.toHaveBeenCalled();
    });

    it('should approve when allowance is insufficient', async () => {
      const wallet = makeSelectedWallet();
      mockTokenApprove.getAllowance.mockResolvedValue(500n);
      mockTokenApprove.approveToken.mockResolvedValue({
        status: 'confirmed',
        txHash: '0xApproveTxHash',
      });

      await adapter.ensureApproval(params, wallet as any, ROUTER);

      expect(mockTokenApprove.approveToken).toHaveBeenCalledWith(expect.objectContaining({
        chainId: params.chainId,
        tokenAddress: params.tokenIn,
        spender: ROUTER,
        amount: 1000000n,
      }));
    });

    it('should throw when approval fails', async () => {
      const wallet = makeSelectedWallet();
      mockTokenApprove.getAllowance.mockResolvedValue(0n);
      mockTokenApprove.approveToken.mockResolvedValue({
        status: 'failed',
        txHash: '0xFailedApprove',
      });

      await expect(
        adapter.ensureApproval(params, wallet as any, ROUTER),
      ).rejects.toThrow('ERC20 approve failed');
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // submitLeg — full flow (mock calculateAmountOutMin to avoid real RPC)
  // ─────────────────────────────────────────────────────────────────────

  describe('submitLeg — success flow', () => {
    it('should return externalOrderId on successful swap', async () => {
      const plan = makePlan();
      const leg = makeLeg();
      const wallet = makeSelectedWallet();

      mockRpcProviderManager.getProvider.mockReturnValue(makeMockProvider());
      mockWalletManager.selectWallet.mockResolvedValue(wallet);
      mockTokenApprove.getAllowance.mockResolvedValue(10000000n);
      mockGasEstimator.estimateGas.mockResolvedValue({
        gasLimit: 200000n,
        feeData: {
          maxFeePerGas: 1000000000n,
          maxPriorityFeePerGas: 100000000n,
        },
        withinPolicy: true,
        estimatedCostEth: '0.0002',
      });

      // Mock calculateAmountOutMin to avoid real Contract.call
      const spy = jest.spyOn(adapter, 'calculateAmountOutMin').mockResolvedValue({ amountOutMin: '950000', expectedAmountOut: '950000' });

      wallet._mockWait.mockResolvedValue({
        status: 1,
        gasUsed: 180000n,
        blockNumber: 12345,
      });

      const result = await adapter.submitLeg(plan, leg);

      expect(result).toMatchObject({ externalOrderId: '0xTxHash123' });
      expect(mockWalletManager.selectWallet).toHaveBeenCalled();
      expect(spy).toHaveBeenCalled();

      spy.mockRestore();
    });
  });

  describe('submitLeg — gas policy rejection', () => {
    it('should throw when gas exceeds policy', async () => {
      const plan = makePlan();
      const leg = makeLeg();
      const wallet = makeSelectedWallet();

      mockRpcProviderManager.getProvider.mockReturnValue(makeMockProvider());
      mockWalletManager.selectWallet.mockResolvedValue(wallet);
      mockTokenApprove.getAllowance.mockResolvedValue(10000000n);
      mockGasEstimator.estimateGas.mockResolvedValue({
        gasLimit: 200000n,
        feeData: {
          maxFeePerGas: 50000000000n,
          maxPriorityFeePerGas: 2000000000n,
        },
        withinPolicy: false,
        policyWarning: 'Gas price 50.00 GWEI exceeds policy max 30 GWEI',
        estimatedCostEth: '0.01',
      });

      const spy = jest.spyOn(adapter, 'calculateAmountOutMin').mockResolvedValue({ amountOutMin: '950000', expectedAmountOut: '950000' });

      await expect(adapter.submitLeg(plan, leg)).rejects.toThrow('gas price exceeds policy');

      spy.mockRestore();
    });
  });

  describe('submitLeg — tx reverted', () => {
    it('should throw when tx reverts on-chain', async () => {
      const plan = makePlan();
      const leg = makeLeg();
      const wallet = makeSelectedWallet();

      mockRpcProviderManager.getProvider.mockReturnValue(makeMockProvider());
      mockWalletManager.selectWallet.mockResolvedValue(wallet);
      mockTokenApprove.getAllowance.mockResolvedValue(10000000n);
      mockGasEstimator.estimateGas.mockResolvedValue({
        gasLimit: 200000n,
        feeData: { maxFeePerGas: 1000000000n, maxPriorityFeePerGas: 100000000n },
        withinPolicy: true,
        estimatedCostEth: '0.0002',
      });

      const spy = jest.spyOn(adapter, 'calculateAmountOutMin').mockResolvedValue({ amountOutMin: '950000', expectedAmountOut: '950000' });

      wallet._mockWait.mockResolvedValue({
        status: 0,
        gasUsed: 180000n,
        blockNumber: 12345,
      });

      await expect(adapter.submitLeg(plan, leg)).rejects.toThrow('reverted on-chain');

      spy.mockRestore();
    });
  });

  describe('submitLeg — null receipt', () => {
    it('should throw when receipt is null', async () => {
      const plan = makePlan();
      const leg = makeLeg();
      const wallet = makeSelectedWallet();

      mockRpcProviderManager.getProvider.mockReturnValue(makeMockProvider());
      mockWalletManager.selectWallet.mockResolvedValue(wallet);
      mockTokenApprove.getAllowance.mockResolvedValue(10000000n);
      mockGasEstimator.estimateGas.mockResolvedValue({
        gasLimit: 200000n,
        feeData: { maxFeePerGas: 1000000000n, maxPriorityFeePerGas: 100000000n },
        withinPolicy: true,
        estimatedCostEth: '0.0002',
      });

      const spy = jest.spyOn(adapter, 'calculateAmountOutMin').mockResolvedValue({ amountOutMin: '950000', expectedAmountOut: '950000' });

      wallet._mockWait.mockResolvedValue(null);

      await expect(adapter.submitLeg(plan, leg)).rejects.toThrow('not confirmed within timeout');

      spy.mockRestore();
    });
  });

  describe('submitLeg — unexpected error', () => {
    it('should wrap unexpected errors as transient', async () => {
      const plan = makePlan();
      const leg = makeLeg();

      mockRpcProviderManager.getProvider.mockImplementation(() => {
        throw new Error('RPC connection failed');
      });

      await expect(adapter.submitLeg(plan, leg)).rejects.toThrow('unexpected error');
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // D4-B-2d: live risk gate (evaluateTrade / recordTradeVolume)
  // ─────────────────────────────────────────────────────────────────────

  describe('submitLeg — D4-B-2d live risk gate', () => {
    it('should call evaluateTrade before wallet selection on the live path', async () => {
      const plan = makePlan();
      const leg = makeLeg();
      const wallet = makeSelectedWallet();

      mockRpcProviderManager.getProvider.mockReturnValue(makeMockProvider());
      mockWalletManager.selectWallet.mockResolvedValue(wallet);
      mockTokenApprove.getAllowance.mockResolvedValue(10000000n);
      mockGasEstimator.estimateGas.mockResolvedValue({
        gasLimit: 200000n,
        feeData: { maxFeePerGas: 1000000000n, maxPriorityFeePerGas: 100000000n },
        withinPolicy: true,
        estimatedCostEth: '0.0002',
      });
      jest.spyOn(adapter, 'calculateAmountOutMin').mockResolvedValue({ amountOutMin: '950000', expectedAmountOut: '950000' });
      wallet._mockWait.mockResolvedValue({ status: 1, gasUsed: 180000n, blockNumber: 12345 });

      await adapter.submitLeg(plan, leg);

      expect(mockPriceOracle.getTokenPriceUsd).toHaveBeenCalledWith(
        42161,
        TOKEN_IN,
      );
      expect(mockPriceOracle.getTokenDecimals).toHaveBeenCalledWith(
        42161,
        TOKEN_IN,
      );
      expect(mockDexRiskPolicy.evaluateTrade).toHaveBeenCalledTimes(1);
      // evaluateTrade must run BEFORE selectWallet (fail-closed before broadcast).
      expect(mockWalletManager.selectWallet).toHaveBeenCalledTimes(1);
    });

    it('should reject with "DEX risk denied" and NOT select wallet when evaluateTrade denies', async () => {
      const plan = makePlan();
      const leg = makeLeg();

      mockRpcProviderManager.getProvider.mockReturnValue(makeMockProvider());
      mockDexRiskPolicy.evaluateTrade.mockResolvedValue({
        allowed: false,
        reasons: ['Position size $10000 exceeds max $500', 'Slippage 80 bps exceeds max 50 bps'],
        warnings: [],
        estimatedSlippageBps: 80,
        estimatedGasCostUsd: 0,
        poolLiquidityUsd: 0,
      });

      await expect(adapter.submitLeg(plan, leg)).rejects.toThrow('DEX risk denied');
      await expect(adapter.submitLeg(plan, leg)).rejects.toThrow('Position size');

      // No broadcast path should have been reached.
      expect(mockWalletManager.selectWallet).not.toHaveBeenCalled();
      expect(mockTokenApprove.approveToken).not.toHaveBeenCalled();
      expect(mockDexRiskPolicy.recordTradeVolume).not.toHaveBeenCalled();
    });

    it('should reject with "cannot price tokenIn" (fail-closed) when oracle returns null price', async () => {
      const plan = makePlan();
      const leg = makeLeg();

      mockRpcProviderManager.getProvider.mockReturnValue(makeMockProvider());
      mockPriceOracle.getTokenPriceUsd.mockResolvedValue(null);

      await expect(adapter.submitLeg(plan, leg)).rejects.toThrow('cannot price tokenIn');

      // evaluateTrade must not run (price resolution is the first gate).
      expect(mockDexRiskPolicy.evaluateTrade).not.toHaveBeenCalled();
      expect(mockWalletManager.selectWallet).not.toHaveBeenCalled();
    });

    it('should reject (fail-closed) when oracle cannot resolve tokenIn decimals', async () => {
      const plan = makePlan();
      const leg = makeLeg();

      mockRpcProviderManager.getProvider.mockReturnValue(makeMockProvider());
      mockPriceOracle.getTokenDecimals.mockResolvedValue(null);

      await expect(adapter.submitLeg(plan, leg)).rejects.toThrow('cannot read decimals');

      expect(mockDexRiskPolicy.evaluateTrade).not.toHaveBeenCalled();
      expect(mockWalletManager.selectWallet).not.toHaveBeenCalled();
    });

    it('should call recordTradeVolume(chainId, amountInUsd) after a successful swap', async () => {
      const plan = makePlan();
      const leg = makeLeg();
      const wallet = makeSelectedWallet();

      mockRpcProviderManager.getProvider.mockReturnValue(makeMockProvider());
      mockWalletManager.selectWallet.mockResolvedValue(wallet);
      mockTokenApprove.getAllowance.mockResolvedValue(10000000n);
      mockGasEstimator.estimateGas.mockResolvedValue({
        gasLimit: 200000n,
        feeData: { maxFeePerGas: 1000000000n, maxPriorityFeePerGas: 100000000n },
        withinPolicy: true,
        estimatedCostEth: '0.0002',
      });
      jest.spyOn(adapter, 'calculateAmountOutMin').mockResolvedValue({ amountOutMin: '950000', expectedAmountOut: '950000' });
      wallet._mockWait.mockResolvedValue({ status: 1, gasUsed: 180000n, blockNumber: 12345 });

      await adapter.submitLeg(plan, leg);

      // amountIn '1000000' with decimals 18 → 1e-12 units × $2500 = $2.5e-9
      // (test tokens are tiny; the assertion is on the (chainId, amountInUsd)
      //  shape, not the magnitude).
      expect(mockDexRiskPolicy.recordTradeVolume).toHaveBeenCalledTimes(1);
      const [recordedChainId, recordedUsd] = mockDexRiskPolicy.recordTradeVolume.mock.calls[0];
      expect(recordedChainId).toBe(42161);
      expect(recordedUsd).toBeCloseTo((1 / 1e12) * 2500, 20);
    });

    it('should not record volume when the tx reverts (success path not reached)', async () => {
      const plan = makePlan();
      const leg = makeLeg();
      const wallet = makeSelectedWallet();

      mockRpcProviderManager.getProvider.mockReturnValue(makeMockProvider());
      mockWalletManager.selectWallet.mockResolvedValue(wallet);
      mockTokenApprove.getAllowance.mockResolvedValue(10000000n);
      mockGasEstimator.estimateGas.mockResolvedValue({
        gasLimit: 200000n,
        feeData: { maxFeePerGas: 1000000000n, maxPriorityFeePerGas: 100000000n },
        withinPolicy: true,
        estimatedCostEth: '0.0002',
      });
      jest.spyOn(adapter, 'calculateAmountOutMin').mockResolvedValue({ amountOutMin: '950000', expectedAmountOut: '950000' });
      wallet._mockWait.mockResolvedValue({ status: 0, gasUsed: 180000n, blockNumber: 12345 });

      await expect(adapter.submitLeg(plan, leg)).rejects.toThrow('reverted on-chain');

      expect(mockDexRiskPolicy.recordTradeVolume).not.toHaveBeenCalled();
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // P9-5: post-quote live slippage gate. Computes the REAL market price impact
  // from the on-chain router quote and blocks when it exceeds the configured
  // maxSlippageBps. Previously the only slippage check compared the tolerance
  // to itself (50 > 50 = false → always allowed).
  // ─────────────────────────────────────────────────────────────────────
  describe('enforcePostQuoteSlippageGate (P9-5)', () => {
    const CHAIN = 42161 as never;
    const TOKEN_IN = '0xTokenIn' as never;
    const TOKEN_OUT = '0xTokenOut' as never;

    function buildMocks(opts: { inDecimals: number; outDecimals: number; inUsd: number | null; outUsd: number | null; maxSlippageBps: number }) {
      const dexRiskPolicy = {
        getEffectiveConfig: jest.fn<any>().mockResolvedValue({ maxSlippageBps: opts.maxSlippageBps }),
      };
      const priceOracle = {
        getTokenDecimals: jest.fn<any>((_c: number, addr: string) =>
          Promise.resolve(addr === TOKEN_IN ? opts.inDecimals : opts.outDecimals),
        ),
        getTokenPriceUsd: jest.fn<any>((_c: number, addr: string) =>
          Promise.resolve(addr === TOKEN_IN ? opts.inUsd : opts.outUsd),
        ),
      };
      return { dexRiskPolicy, priceOracle };
    }

    it('passes when real impact is within maxSlippageBps (same decimals)', async () => {
      const { dexRiskPolicy, priceOracle } = buildMocks({ inDecimals: 18, outDecimals: 18, inUsd: 2500, outUsd: 2500, maxSlippageBps: 50 });
      // amountIn=1e18, expectedOut=0.999e18 → impact ≈ 10 bps (< 50).
      await expect(
        enforcePostQuoteSlippageGate({
          dexRiskPolicy: dexRiskPolicy as any, priceOracle: priceOracle as any, adapterName: 'Test',
          chainId: CHAIN, tokenIn: TOKEN_IN, tokenOut: TOKEN_OUT,
          amountIn: '1000000000000000000', expectedAmountOut: '999000000000000000',
        }),
      ).resolves.toBeUndefined();
    });

    it('blocks when real impact exceeds maxSlippageBps (same decimals)', async () => {
      const { dexRiskPolicy, priceOracle } = buildMocks({ inDecimals: 18, outDecimals: 18, inUsd: 2500, outUsd: 2500, maxSlippageBps: 50 });
      // amountIn=1e18, expectedOut=0.95e18 → impact ≈ 500 bps (> 50).
      await expect(
        enforcePostQuoteSlippageGate({
          dexRiskPolicy: dexRiskPolicy as any, priceOracle: priceOracle as any, adapterName: 'Test',
          chainId: CHAIN, tokenIn: TOKEN_IN, tokenOut: TOKEN_OUT,
          amountIn: '1000000000000000000', expectedAmountOut: '950000000000000000',
        }),
      ).rejects.toThrow(/live slippage gate blocked — real price impact 5\d\d bps exceeds max 50 bps/);
    });

    it('does NOT block when expectedOut > amountIn (arbitrage edge, impact clamped to 0)', async () => {
      const { dexRiskPolicy, priceOracle } = buildMocks({ inDecimals: 6, outDecimals: 6, inUsd: 1, outUsd: 1, maxSlippageBps: 10 });
      await expect(
        enforcePostQuoteSlippageGate({
          dexRiskPolicy: dexRiskPolicy as any, priceOracle: priceOracle as any, adapterName: 'Test',
          chainId: CHAIN, tokenIn: TOKEN_IN, tokenOut: TOKEN_OUT,
          amountIn: '1000000', expectedAmountOut: '1005000',
        }),
      ).resolves.toBeUndefined();
    });

    it('fail-closes when decimals cannot be resolved', async () => {
      const dexRiskPolicy = { getEffectiveConfig: jest.fn<any>().mockResolvedValue({ maxSlippageBps: 50 }) };
      const priceOracle = {
        getTokenDecimals: jest.fn<any>().mockResolvedValue(null),
        getTokenPriceUsd: jest.fn<any>().mockResolvedValue(1),
      };
      await expect(
        enforcePostQuoteSlippageGate({
          dexRiskPolicy: dexRiskPolicy as any, priceOracle: priceOracle as any, adapterName: 'Test',
          chainId: CHAIN, tokenIn: TOKEN_IN, tokenOut: TOKEN_OUT,
          amountIn: '1000', expectedAmountOut: '999',
        }),
      ).rejects.toThrow(/cannot read decimals for slippage check/);
    });

    it('fail-closes when cross-decimals USD price cannot be resolved', async () => {
      const { dexRiskPolicy, priceOracle } = buildMocks({ inDecimals: 18, outDecimals: 6, inUsd: null, outUsd: 1, maxSlippageBps: 50 });
      await expect(
        enforcePostQuoteSlippageGate({
          dexRiskPolicy: dexRiskPolicy as any, priceOracle: priceOracle as any, adapterName: 'Test',
          chainId: CHAIN, tokenIn: TOKEN_IN, tokenOut: TOKEN_OUT,
          amountIn: '1000000000000000000', expectedAmountOut: '1990000000',
        }),
      ).rejects.toThrow(/cannot price tokens for cross-decimals slippage check/);
    });
  });
});