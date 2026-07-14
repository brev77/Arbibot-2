/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { getArbibotMetricsRegistry } from '@arbibot/nest-platform';

import { SushiSwapV2Adapter } from './sushiswap-v2.adapter';
import {
  VenueSubmitClientError,
  VenueSubmitTransientError,
  VenueTerminalSubmitError,
} from '../../venue/venue-adapter';

// ───────────────────────────────────────────────────────────────────────
// Mocks — typed as Record<string, any> to avoid Jest assignability issues
// ───────────────────────────────────────────────────────────────────────

const mockRpcProviderManager: Record<string, any> = {
  getProvider: jest.fn(),
};

const mockWalletManager: Record<string, any> = {
  selectWallet: jest.fn(),
};

const mockGasEstimator: Record<string, any> = {
  estimateGas: jest.fn(),
};

const mockTokenApprove: Record<string, any> = {
  getAllowance: jest.fn(),
  approveToken: jest.fn(),
};

// D4-B-2d: risk-gate + price-oracle mocks (see uniswap-v2.adapter.spec.ts).
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
};

const mockPriceOracle: Record<string, any> = {
  getTokenPriceUsd: jest.fn<any>().mockResolvedValue(2500),
  getTokenDecimals: jest.fn<any>().mockResolvedValue(18),
};

// ───────────────────────────────────────────────────────────────────────
// Test data
// ───────────────────────────────────────────────────────────────────────

const TOKEN_IN = '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1' as any;
const TOKEN_OUT = '0xaf88d065e77c8cC2239327C5EDb3A432268e5831' as any;
const FROM = '0x1234567890123456789012345678901234567890' as any;

function makePlan(dexSwaps: Record<string, unknown>[] | null = null) {
  return {
    id: 'plan-1',
    playbookConfig: dexSwaps === null ? null : { dexSwaps },
  };
}

function makeLeg(legIndex = 0) {
  return { id: 'leg-1', legIndex };
}

function makeSwapParams(overrides: Record<string, unknown> = {}) {
  return {
    chainId: 42161,
    tokenIn: TOKEN_IN,
    tokenOut: TOKEN_OUT,
    amountIn: '1000000000000000000',
    ...overrides,
  };
}

function makeSelectedWallet(address = FROM) {
  const mockWait = jest.fn() as any;
  const mockSendTx = jest.fn() as any;
  mockSendTx.mockResolvedValue({
    hash: '0xTxHashSushi',
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

function makeMockProvider(): Record<string, any> {
  return {
    getFeeData: jest.fn(),
    getBlock: jest.fn(),
    estimateGas: jest.fn(),
  };
}

const MOCK_GAS_ESTIMATION = {
  withinPolicy: true,
  gasLimit: BigInt(300000),
  estimatedCostEth: '0.001',
  policyWarning: undefined as string | undefined,
  feeData: {
    maxFeePerGas: BigInt(1000000000),
    maxPriorityFeePerGas: BigInt(100000000),
  },
};

// ───────────────────────────────────────────────────────────────────────
// Tests
// ───────────────────────────────────────────────────────────────────────

describe('SushiSwapV2Adapter', () => {
  let adapter: SushiSwapV2Adapter;

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

    adapter = new SushiSwapV2Adapter(
      mockRpcProviderManager as any,
      mockWalletManager as any,
      mockGasEstimator as any,
      mockTokenApprove as any,
      mockDexRiskPolicy as any,
      mockPriceOracle as any,
    );
  });

  // ─────────────────────────────────────────────────────────────────────
  // Validation
  // ─────────────────────────────────────────────────────────────────────

  describe('validation', () => {
    it('should throw VenueSubmitClientError when playbookConfig is missing', async () => {
      const plan = { id: 'plan-1', playbookConfig: null };
      const leg = makeLeg();

      await expect(adapter.submitLeg(plan as any, leg as any)).rejects.toThrow(VenueSubmitClientError);
      await expect(adapter.submitLeg(plan as any, leg as any)).rejects.toThrow('missing playbookConfig');
    });

    it('should throw VenueSubmitClientError when dexSwaps is not an array', async () => {
      const plan = makePlan(null);
      (plan as any).playbookConfig = { dexSwaps: 'not-array' };
      const leg = makeLeg();

      await expect(adapter.submitLeg(plan as any, leg as any)).rejects.toThrow('no swap params');
    });

    it('should throw VenueSubmitClientError when no swap params at legIndex', async () => {
      const plan = makePlan([makeSwapParams()]);
      const leg = makeLeg(5);

      await expect(adapter.submitLeg(plan as any, leg as any)).rejects.toThrow('no swap params');
    });

    it('should throw VenueSubmitClientError when required fields missing', async () => {
      const plan = makePlan([{ chainId: 42161 }]);
      const leg = makeLeg();

      await expect(adapter.submitLeg(plan as any, leg as any)).rejects.toThrow('no swap params');
    });

    it('should throw VenueSubmitClientError for unsupported chainId', async () => {
      const plan = makePlan([makeSwapParams({ chainId: 99999 })]);
      const leg = makeLeg();

      mockRpcProviderManager.getProvider.mockReturnValue(makeMockProvider());

      await expect(adapter.submitLeg(plan as any, leg as any)).rejects.toThrow('unsupported chainId');
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // buildSwapTxRequest
  // ─────────────────────────────────────────────────────────────────────

  describe('buildSwapTxRequest', () => {
    it('should encode swapExactTokensForTokens calldata', () => {
      const request = adapter.buildSwapTxRequest(
        '0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506',
        '1000000000000000000',
        '990000000',
        [TOKEN_IN, TOKEN_OUT],
        '0x0000000000000000000000000000000000000def',
        1700000000,
        FROM,
      );

      expect(request.to).toBe('0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506');
      expect(request.value).toBe(0n);
      expect(request.from).toBe(FROM);
      expect(typeof request.data).toBe('string');
      expect(request.data.length).toBeGreaterThan(8);
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // ensureApproval
  // ─────────────────────────────────────────────────────────────────────

  describe('ensureApproval', () => {
    const params = makeSwapParams();
    const routerAddress = '0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506' as any;

    it('should skip approval when allowance is sufficient', async () => {
      const wallet = makeSelectedWallet();
      mockTokenApprove.getAllowance.mockResolvedValue(BigInt('2000000000000000000'));

      await adapter.ensureApproval(params, wallet as any, routerAddress);

      expect(mockTokenApprove.approveToken).not.toHaveBeenCalled();
    });

    it('should approve when allowance is insufficient', async () => {
      const wallet = makeSelectedWallet();
      mockTokenApprove.getAllowance.mockResolvedValue(BigInt(0));
      mockTokenApprove.approveToken.mockResolvedValue({
        status: 'confirmed',
        txHash: '0xapprove123',
      });

      await adapter.ensureApproval(params, wallet as any, routerAddress);

      expect(mockTokenApprove.approveToken).toHaveBeenCalledTimes(1);
      expect(mockTokenApprove.approveToken).toHaveBeenCalledWith(
        expect.objectContaining({
          spender: routerAddress,
          amount: BigInt('1000000000000000000'),
        }),
      );
    });

    it('should throw VenueSubmitClientError when approve fails', async () => {
      const wallet = makeSelectedWallet();
      mockTokenApprove.getAllowance.mockResolvedValue(BigInt(0));
      mockTokenApprove.approveToken.mockResolvedValue({
        status: 'failed',
        txHash: '0xapprove123',
      });

      await expect(
        adapter.ensureApproval(params as any, wallet as any, routerAddress),
      ).rejects.toThrow('ERC20 approve failed');
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // submitLeg — success flow
  // ─────────────────────────────────────────────────────────────────────

  describe('submitLeg — success', () => {
    it('should submit swap and return txHash on success', async () => {
      const plan = makePlan([makeSwapParams()]);
      const leg = makeLeg();
      const wallet = makeSelectedWallet();

      mockRpcProviderManager.getProvider.mockReturnValue(makeMockProvider());
      mockWalletManager.selectWallet.mockResolvedValue(wallet);
      mockTokenApprove.getAllowance.mockResolvedValue(BigInt('2000000000000000000'));
      mockGasEstimator.estimateGas.mockResolvedValue(MOCK_GAS_ESTIMATION);

      const spy = jest.spyOn(adapter, 'calculateAmountOutMin').mockResolvedValue('1990000000');

      wallet._mockWait.mockResolvedValue({
        status: 1,
        gasUsed: BigInt(200000),
        blockNumber: 12345678,
      });

      const result = await adapter.submitLeg(plan as any, leg as any);

      expect(result).toEqual({ externalOrderId: '0xTxHashSushi' });
      expect(mockWalletManager.selectWallet).toHaveBeenCalled();

      spy.mockRestore();
    });

    it('should call wallet.sendTransaction with EIP-1559 params', async () => {
      const plan = makePlan([makeSwapParams()]);
      const leg = makeLeg();
      const wallet = makeSelectedWallet();

      mockRpcProviderManager.getProvider.mockReturnValue(makeMockProvider());
      mockWalletManager.selectWallet.mockResolvedValue(wallet);
      mockTokenApprove.getAllowance.mockResolvedValue(BigInt('2000000000000000000'));
      mockGasEstimator.estimateGas.mockResolvedValue(MOCK_GAS_ESTIMATION);

      const spy = jest.spyOn(adapter, 'calculateAmountOutMin').mockResolvedValue('1990000000');

      wallet._mockWait.mockResolvedValue({
        status: 1,
        gasUsed: BigInt(200000),
        blockNumber: 12345678,
      });

      await adapter.submitLeg(plan as any, leg as any);

      expect(wallet.wallet.sendTransaction).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 2,
          gasLimit: MOCK_GAS_ESTIMATION.gasLimit,
          maxFeePerGas: MOCK_GAS_ESTIMATION.feeData.maxFeePerGas,
          maxPriorityFeePerGas: MOCK_GAS_ESTIMATION.feeData.maxPriorityFeePerGas,
        }),
      );

      spy.mockRestore();
    });

    it('should select wallet with correct params', async () => {
      const plan = makePlan([makeSwapParams()]);
      const leg = makeLeg();
      const wallet = makeSelectedWallet();

      mockRpcProviderManager.getProvider.mockReturnValue(makeMockProvider());
      mockWalletManager.selectWallet.mockResolvedValue(wallet);
      mockTokenApprove.getAllowance.mockResolvedValue(BigInt('2000000000000000000'));
      mockGasEstimator.estimateGas.mockResolvedValue(MOCK_GAS_ESTIMATION);

      const spy = jest.spyOn(adapter, 'calculateAmountOutMin').mockResolvedValue('1990000000');

      wallet._mockWait.mockResolvedValue({
        status: 1,
        gasUsed: BigInt(200000),
        blockNumber: 12345678,
      });

      await adapter.submitLeg(plan as any, leg as any);

      expect(mockWalletManager.selectWallet).toHaveBeenCalledWith(
        42161,
        expect.anything(),
        TOKEN_IN,
        BigInt('1000000000000000000'),
      );

      spy.mockRestore();
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // submitLeg — error flows
  // ─────────────────────────────────────────────────────────────────────

  describe('submitLeg — errors', () => {
    it('should throw VenueSubmitClientError when gas exceeds policy', async () => {
      const plan = makePlan([makeSwapParams()]);
      const leg = makeLeg();
      const wallet = makeSelectedWallet();

      mockRpcProviderManager.getProvider.mockReturnValue(makeMockProvider());
      mockWalletManager.selectWallet.mockResolvedValue(wallet);
      mockTokenApprove.getAllowance.mockResolvedValue(BigInt('2000000000000000000'));
      mockGasEstimator.estimateGas.mockResolvedValue({
        ...MOCK_GAS_ESTIMATION,
        withinPolicy: false,
        policyWarning: 'maxFeePerGas exceeds 50 gwei',
      });

      const spy = jest.spyOn(adapter, 'calculateAmountOutMin').mockResolvedValue('1990000000');

      await expect(adapter.submitLeg(plan as any, leg as any)).rejects.toThrow('gas price exceeds policy');

      spy.mockRestore();
    });

    it('should throw VenueSubmitTransientError when tx receipt is null', async () => {
      const plan = makePlan([makeSwapParams()]);
      const leg = makeLeg();
      const wallet = makeSelectedWallet();

      mockRpcProviderManager.getProvider.mockReturnValue(makeMockProvider());
      mockWalletManager.selectWallet.mockResolvedValue(wallet);
      mockTokenApprove.getAllowance.mockResolvedValue(BigInt('2000000000000000000'));
      mockGasEstimator.estimateGas.mockResolvedValue(MOCK_GAS_ESTIMATION);

      const spy = jest.spyOn(adapter, 'calculateAmountOutMin').mockResolvedValue('1990000000');

      wallet._mockWait.mockResolvedValue(null);

      await expect(adapter.submitLeg(plan as any, leg as any)).rejects.toThrow('null receipt');
      await expect(adapter.submitLeg(plan as any, leg as any)).rejects.toThrow(VenueSubmitTransientError);

      spy.mockRestore();
    });

    it('should throw VenueTerminalSubmitError when tx reverted on-chain', async () => {
      const plan = makePlan([makeSwapParams()]);
      const leg = makeLeg();
      const wallet = makeSelectedWallet();

      mockRpcProviderManager.getProvider.mockReturnValue(makeMockProvider());
      mockWalletManager.selectWallet.mockResolvedValue(wallet);
      mockTokenApprove.getAllowance.mockResolvedValue(BigInt('2000000000000000000'));
      mockGasEstimator.estimateGas.mockResolvedValue(MOCK_GAS_ESTIMATION);

      const spy = jest.spyOn(adapter, 'calculateAmountOutMin').mockResolvedValue('1990000000');

      wallet._mockWait.mockResolvedValue({
        status: 0,
        gasUsed: BigInt(200000),
        blockNumber: 12345678,
      });

      await expect(adapter.submitLeg(plan as any, leg as any)).rejects.toThrow('reverted on-chain');
      await expect(adapter.submitLeg(plan as any, leg as any)).rejects.toThrow(VenueTerminalSubmitError);

      spy.mockRestore();
    });

    it('should wrap unexpected errors as VenueSubmitTransientError', async () => {
      const plan = makePlan([makeSwapParams()]);
      const leg = makeLeg();
      const wallet = makeSelectedWallet();

      mockRpcProviderManager.getProvider.mockReturnValue(makeMockProvider());
      mockWalletManager.selectWallet.mockResolvedValue(wallet);
      mockTokenApprove.getAllowance.mockResolvedValue(BigInt('2000000000000000000'));
      mockGasEstimator.estimateGas.mockResolvedValue(MOCK_GAS_ESTIMATION);

      const spy = jest.spyOn(adapter, 'calculateAmountOutMin').mockResolvedValue('1990000000');

      wallet.wallet.sendTransaction.mockRejectedValue(new Error('RPC timeout'));

      await expect(adapter.submitLeg(plan as any, leg as any)).rejects.toThrow('unexpected error');
      await expect(adapter.submitLeg(plan as any, leg as any)).rejects.toThrow(VenueSubmitTransientError);

      spy.mockRestore();
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // Router address resolution
  // ─────────────────────────────────────────────────────────────────────

  describe('router address resolution', () => {
    it('should resolve Arbitrum SushiSwap router for chainId 42161', async () => {
      const plan = makePlan([makeSwapParams({ chainId: 42161 })]);
      const leg = makeLeg();
      const wallet = makeSelectedWallet();

      mockRpcProviderManager.getProvider.mockReturnValue(makeMockProvider());
      mockWalletManager.selectWallet.mockResolvedValue(wallet);
      mockTokenApprove.getAllowance.mockResolvedValue(BigInt('2000000000000000000'));
      mockGasEstimator.estimateGas.mockResolvedValue(MOCK_GAS_ESTIMATION);

      const spy = jest.spyOn(adapter, 'calculateAmountOutMin').mockResolvedValue('1990000000');

      wallet._mockWait.mockResolvedValue({
        status: 1,
        gasUsed: BigInt(200000),
        blockNumber: 12345678,
      });

      const result = await adapter.submitLeg(plan as any, leg as any);
      expect(result.externalOrderId).toBe('0xTxHashSushi');

      spy.mockRestore();
    });

    it('should resolve BNB Chain SushiSwap router for chainId 56', async () => {
      const plan = makePlan([makeSwapParams({ chainId: 56 })]);
      const leg = makeLeg();
      const wallet = makeSelectedWallet();

      mockRpcProviderManager.getProvider.mockReturnValue(makeMockProvider());
      mockWalletManager.selectWallet.mockResolvedValue(wallet);
      mockTokenApprove.getAllowance.mockResolvedValue(BigInt('2000000000000000000'));
      mockGasEstimator.estimateGas.mockResolvedValue(MOCK_GAS_ESTIMATION);

      const spy = jest.spyOn(adapter, 'calculateAmountOutMin').mockResolvedValue('1990000000');

      wallet._mockWait.mockResolvedValue({
        status: 1,
        gasUsed: BigInt(200000),
        blockNumber: 12345678,
      });

      const result = await adapter.submitLeg(plan as any, leg as any);
      expect(result.externalOrderId).toBe('0xTxHashSushi');

      spy.mockRestore();
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // Base chain — no SushiSwap deployment
  // ─────────────────────────────────────────────────────────────────────

  describe('Base chain — no SushiSwap', () => {
    it('should throw VenueSubmitClientError for Base Sepolia (no SushiSwap deployment)', async () => {
      const plan = makePlan([makeSwapParams({ chainId: 84532 })]);
      const leg = makeLeg();

      mockRpcProviderManager.getProvider.mockReturnValue(makeMockProvider());

      await expect(adapter.submitLeg(plan as any, leg as any)).rejects.toThrow('no SushiSwap deployment');
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // D4-B-2d: live risk gate (evaluateTrade / recordTradeVolume)
  // ─────────────────────────────────────────────────────────────────────

  describe('submitLeg — D4-B-2d live risk gate', () => {
    it('should call evaluateTrade before wallet selection on the live path', async () => {
      const plan = makePlan([makeSwapParams()]);
      const leg = makeLeg();
      const wallet = makeSelectedWallet();

      mockRpcProviderManager.getProvider.mockReturnValue(makeMockProvider());
      mockWalletManager.selectWallet.mockResolvedValue(wallet);
      mockTokenApprove.getAllowance.mockResolvedValue(BigInt('2000000000000000000'));
      mockGasEstimator.estimateGas.mockResolvedValue(MOCK_GAS_ESTIMATION);
      const spy = jest.spyOn(adapter, 'calculateAmountOutMin').mockResolvedValue('1990000000');
      wallet._mockWait.mockResolvedValue({ status: 1, gasUsed: BigInt(200000), blockNumber: 12345678 });

      await adapter.submitLeg(plan as any, leg as any);

      expect(mockPriceOracle.getTokenPriceUsd).toHaveBeenCalledWith(42161, TOKEN_IN);
      expect(mockDexRiskPolicy.evaluateTrade).toHaveBeenCalledTimes(1);
      expect(mockWalletManager.selectWallet).toHaveBeenCalledTimes(1);
      spy.mockRestore();
    });

    it('should reject with "DEX risk denied" and NOT select wallet when evaluateTrade denies', async () => {
      const plan = makePlan([makeSwapParams()]);
      const leg = makeLeg();

      mockRpcProviderManager.getProvider.mockReturnValue(makeMockProvider());
      mockDexRiskPolicy.evaluateTrade.mockResolvedValue({
        allowed: false,
        reasons: ['Position size $10000 exceeds max $500'],
        warnings: [],
        estimatedSlippageBps: 80,
        estimatedGasCostUsd: 0,
        poolLiquidityUsd: 0,
      });

      await expect(adapter.submitLeg(plan as any, leg as any)).rejects.toThrow('DEX risk denied');

      expect(mockWalletManager.selectWallet).not.toHaveBeenCalled();
      expect(mockDexRiskPolicy.recordTradeVolume).not.toHaveBeenCalled();
    });

    it('should reject with "cannot price tokenIn" (fail-closed) when oracle returns null price', async () => {
      const plan = makePlan([makeSwapParams()]);
      const leg = makeLeg();

      mockRpcProviderManager.getProvider.mockReturnValue(makeMockProvider());
      mockPriceOracle.getTokenPriceUsd.mockResolvedValue(null);

      await expect(adapter.submitLeg(plan as any, leg as any)).rejects.toThrow('cannot price tokenIn');

      expect(mockDexRiskPolicy.evaluateTrade).not.toHaveBeenCalled();
      expect(mockWalletManager.selectWallet).not.toHaveBeenCalled();
    });

    it('should reject (fail-closed) when oracle cannot resolve tokenIn decimals', async () => {
      const plan = makePlan([makeSwapParams()]);
      const leg = makeLeg();

      mockRpcProviderManager.getProvider.mockReturnValue(makeMockProvider());
      mockPriceOracle.getTokenDecimals.mockResolvedValue(null);

      await expect(adapter.submitLeg(plan as any, leg as any)).rejects.toThrow('cannot read decimals');

      expect(mockDexRiskPolicy.evaluateTrade).not.toHaveBeenCalled();
      expect(mockWalletManager.selectWallet).not.toHaveBeenCalled();
    });

    it('should call recordTradeVolume(chainId, amountInUsd) after a successful swap', async () => {
      const plan = makePlan([makeSwapParams()]);
      const leg = makeLeg();
      const wallet = makeSelectedWallet();

      mockRpcProviderManager.getProvider.mockReturnValue(makeMockProvider());
      mockWalletManager.selectWallet.mockResolvedValue(wallet);
      mockTokenApprove.getAllowance.mockResolvedValue(BigInt('2000000000000000000'));
      mockGasEstimator.estimateGas.mockResolvedValue(MOCK_GAS_ESTIMATION);
      const spy = jest.spyOn(adapter, 'calculateAmountOutMin').mockResolvedValue('1990000000');
      wallet._mockWait.mockResolvedValue({ status: 1, gasUsed: BigInt(200000), blockNumber: 12345678 });

      await adapter.submitLeg(plan as any, leg as any);

      expect(mockDexRiskPolicy.recordTradeVolume).toHaveBeenCalledTimes(1);
      const [recordedChainId, recordedUsd] = mockDexRiskPolicy.recordTradeVolume.mock.calls[0];
      expect(recordedChainId).toBe(42161);
      // amountIn '1000000000000000000' / 10^18 × $2500 = $2500
      expect(recordedUsd).toBeCloseTo(2500, 10);
      spy.mockRestore();
    });

    it('should not record volume when the tx reverts (success path not reached)', async () => {
      const plan = makePlan([makeSwapParams()]);
      const leg = makeLeg();
      const wallet = makeSelectedWallet();

      mockRpcProviderManager.getProvider.mockReturnValue(makeMockProvider());
      mockWalletManager.selectWallet.mockResolvedValue(wallet);
      mockTokenApprove.getAllowance.mockResolvedValue(BigInt('2000000000000000000'));
      mockGasEstimator.estimateGas.mockResolvedValue(MOCK_GAS_ESTIMATION);
      const spy = jest.spyOn(adapter, 'calculateAmountOutMin').mockResolvedValue('1990000000');
      wallet._mockWait.mockResolvedValue({ status: 0, gasUsed: BigInt(200000), blockNumber: 12345678 });

      await expect(adapter.submitLeg(plan as any, leg as any)).rejects.toThrow('reverted on-chain');

      expect(mockDexRiskPolicy.recordTradeVolume).not.toHaveBeenCalled();
      spy.mockRestore();
    });
  });
});