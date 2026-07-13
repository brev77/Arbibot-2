/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { getArbibotMetricsRegistry } from '@arbibot/nest-platform';

import { UniswapV3Adapter } from './uniswap-v3.adapter';

// ───────────────────────────────────────────────────────────────────────
// Valid Ethereum addresses for ethers.js v6 compatibility
// ───────────────────────────────────────────────────────────────────────

const TOKEN_IN = '0x0000000000000000000000000000000000000001' as any;
const TOKEN_OUT = '0x0000000000000000000000000000000000000002' as any;
const ROUTER = '0x0000000000000000000000000000000000000abc' as any;
const RECIPIENT = '0x0000000000000000000000000000000000000def' as any;
const FROM = '0x1234567890abcdef1234567890abcdef12345678' as any;

// ───────────────────────────────────────────────────────────────────────
// Mocks
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

// Helper: create a minimal plan entity with V3 swap params
function makePlan(overrides: Partial<{
  id: string;
  playbookConfig: Record<string, unknown> | null;
}> = {}): any {
  return {
    id: overrides.id ?? 'plan-v3-001',
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
              fee: 3000,
              amountIn: '1000000',
              amountOutExpected: '990000',
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
    id: overrides.id ?? 'leg-v3-001',
    planId: 'plan-v3-001',
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
    hash: '0xV3TxHash123',
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

describe('UniswapV3Adapter', () => {
  let adapter: UniswapV3Adapter;

  beforeEach(() => {
    getArbibotMetricsRegistry().clear();
    jest.clearAllMocks();

    adapter = new UniswapV3Adapter(
      mockRpcProviderManager as any,
      mockWalletManager as any,
      mockGasEstimator as any,
      mockTokenApprove as any,
    );
  });

  // ─────────────────────────────────────────────────────────────────────
  // calculateAmountOutMin
  // ─────────────────────────────────────────────────────────────────────

  describe('calculateAmountOutMin', () => {
    it('should apply slippage to amountOutExpected', () => {
      const result = adapter.calculateAmountOutMin({
        chainId: 42161,
        tokenIn: TOKEN_IN,
        tokenOut: TOKEN_OUT,
        fee: 3000,
        amountIn: '1000000',
        amountOutExpected: '1000000',
        slippageBps: 50,
      });
      // 1000000 * (10000 - 50) / 10000 = 995000
      expect(result).toBe('995000');
    });

    it('should use env default slippage when not specified', () => {
      const result = adapter.calculateAmountOutMin({
        chainId: 42161,
        tokenIn: TOKEN_IN,
        tokenOut: TOKEN_OUT,
        fee: 3000,
        amountIn: '1000000',
        amountOutExpected: '2000000',
      });
      // Default slippage = 50 bps → 2000000 * 9950/10000 = 1990000
      expect(result).toBe('1990000');
    });

    it('should handle large amounts', () => {
      const result = adapter.calculateAmountOutMin({
        chainId: 42161,
        tokenIn: TOKEN_IN,
        tokenOut: TOKEN_OUT,
        fee: 3000,
        amountIn: '1000000000000000000',
        amountOutExpected: '500000000000000000',
        slippageBps: 100,
      });
      // 500000000000000000 * 9900/10000 = 495000000000000000
      expect(result).toBe('495000000000000000');
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // buildSwapTxRequest
  // ─────────────────────────────────────────────────────────────────────

  describe('buildSwapTxRequest', () => {
    it('should encode exactInputSingle calldata with struct params', () => {
      const params = {
        chainId: 42161 as any,
        tokenIn: TOKEN_IN,
        tokenOut: TOKEN_OUT,
        fee: 3000,
        amountIn: '1000000',
        amountOutExpected: '990000',
      };

      const result = adapter.buildSwapTxRequest(
        ROUTER,
        params,
        '985050',
        RECIPIENT,
        9999999999,
        FROM,
      );

      expect(result.to).toBe(ROUTER);
      expect(result.value).toBe(0n);
      expect(result.from).toBe(FROM);
      // exactInputSingle function selector = 0x04e45aaf
      expect(result.data).toContain('04e45aaf');
    });

    it('should encode with custom sqrtPriceLimitX96', () => {
      const params = {
        chainId: 42161 as any,
        tokenIn: TOKEN_IN,
        tokenOut: TOKEN_OUT,
        fee: 500,
        amountIn: '1000000',
        amountOutExpected: '990000',
        sqrtPriceLimitX96: '79228162514264337593543950336',
      };

      const result = adapter.buildSwapTxRequest(
        ROUTER,
        params,
        '985050',
        RECIPIENT,
        9999999999,
        FROM,
      );

      expect(result.to).toBe(ROUTER);
      expect(result.data).toContain('04e45aaf');
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

    it('should throw when amountOutExpected is missing', async () => {
      const plan = makePlan({
        playbookConfig: {
          dexSwaps: [{
            chainId: 42161,
            tokenIn: TOKEN_IN,
            tokenOut: TOKEN_OUT,
            amountIn: '1000',
          }],
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
            amountOutExpected: '900',
          }],
        },
      });
      const leg = makeLeg();

      mockRpcProviderManager.getProvider.mockReturnValue(makeMockProvider());

      await expect(adapter.submitLeg(plan, leg)).rejects.toThrow('unsupported chainId');
    });

    it('should throw when fee is out of uint24 range', async () => {
      const plan = makePlan({
        playbookConfig: {
          dexSwaps: [{
            chainId: 42161,
            tokenIn: TOKEN_IN,
            tokenOut: TOKEN_OUT,
            fee: 99999999,
            amountIn: '1000',
            amountOutExpected: '900',
          }],
        },
      });
      const leg = makeLeg();

      mockRpcProviderManager.getProvider.mockReturnValue(makeMockProvider());

      await expect(adapter.submitLeg(plan, leg)).rejects.toThrow('fee must be uint24');
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
            venueKey: 'uniswap-v3',
            tokenIn: TOKEN_IN,
            tokenOut: TOKEN_OUT,
            amountIn: '1000',
            amountOutExpected: '900',
          }],
        },
      });
      const leg = makeLeg();

      mockRpcProviderManager.getProvider.mockReturnValue(makeMockProvider());

      await expect(adapter.submitLeg(plan, leg)).rejects.toThrow('unsupported chainId');
    });

    it('should fall back to dexSwaps[] when legs[] has no valid entry', async () => {
      const plan = makePlan({
        playbookConfig: {
          legs: [{ legType: 'bridge' }],
          dexSwaps: [{
            chainId: 99999,
            tokenIn: TOKEN_IN,
            tokenOut: TOKEN_OUT,
            amountIn: '1000',
            amountOutExpected: '900',
          }],
        },
      });
      const leg = makeLeg();

      mockRpcProviderManager.getProvider.mockReturnValue(makeMockProvider());

      await expect(adapter.submitLeg(plan, leg)).rejects.toThrow('unsupported chainId');
    });

    it('should throw for unsupported chainId', async () => {
      const plan = makePlan({
        playbookConfig: {
          dexSwaps: [{
            chainId: 99999,
            tokenIn: TOKEN_IN,
            tokenOut: TOKEN_OUT,
            amountIn: '1000',
            amountOutExpected: '900',
          }],
        },
      });
      const leg = makeLeg();

      mockRpcProviderManager.getProvider.mockReturnValue(makeMockProvider());

      await expect(adapter.submitLeg(plan, leg)).rejects.toThrow('unsupported chainId');
    });

    it('should throw when fee is out of uint24 range', async () => {
      const plan = makePlan({
        playbookConfig: {
          dexSwaps: [{
            chainId: 42161,
            tokenIn: TOKEN_IN,
            tokenOut: TOKEN_OUT,
            fee: 99999999,
            amountIn: '1000',
            amountOutExpected: '900',
          }],
        },
      });
      const leg = makeLeg();

      mockRpcProviderManager.getProvider.mockReturnValue(makeMockProvider());

      await expect(adapter.submitLeg(plan, leg)).rejects.toThrow('fee must be uint24');
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
      fee: 3000,
      amountIn: '1000000',
      amountOutExpected: '990000',
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
        txHash: '0xV3ApproveTxHash',
      });

      await adapter.ensureApproval(params, wallet as any, ROUTER);

      expect(mockTokenApprove.approveToken).toHaveBeenCalledWith({
        chainId: params.chainId,
        tokenAddress: params.tokenIn,
        spender: ROUTER,
        amount: 1000000n,
      });
    });

    it('should throw when approval fails', async () => {
      const wallet = makeSelectedWallet();
      mockTokenApprove.getAllowance.mockResolvedValue(0n);
      mockTokenApprove.approveToken.mockResolvedValue({
        status: 'failed',
        txHash: '0xFailedV3Approve',
      });

      await expect(
        adapter.ensureApproval(params, wallet as any, ROUTER),
      ).rejects.toThrow('ERC20 approve failed');
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // submitLeg — success flow
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
        gasLimit: 250000n,
        feeData: {
          maxFeePerGas: 1000000000n,
          maxPriorityFeePerGas: 100000000n,
        },
        withinPolicy: true,
        estimatedCostEth: '0.00025',
      });

      wallet._mockWait.mockResolvedValue({
        status: 1,
        gasUsed: 220000n,
        blockNumber: 12346,
      });

      const result = await adapter.submitLeg(plan, leg);

      expect(result).toEqual({ externalOrderId: '0xV3TxHash123' });
      expect(mockWalletManager.selectWallet).toHaveBeenCalled();
    });

    it('should use default fee (3000) when fee is omitted', async () => {
      const plan = makePlan({
        playbookConfig: {
          dexSwaps: [{
            chainId: 42161,
            tokenIn: TOKEN_IN,
            tokenOut: TOKEN_OUT,
            // no fee → should default to 3000
            amountIn: '1000000',
            amountOutExpected: '990000',
          }],
        },
      });
      const leg = makeLeg();
      const wallet = makeSelectedWallet();

      mockRpcProviderManager.getProvider.mockReturnValue(makeMockProvider());
      mockWalletManager.selectWallet.mockResolvedValue(wallet);
      mockTokenApprove.getAllowance.mockResolvedValue(10000000n);
      mockGasEstimator.estimateGas.mockResolvedValue({
        gasLimit: 250000n,
        feeData: {
          maxFeePerGas: 1000000000n,
          maxPriorityFeePerGas: 100000000n,
        },
        withinPolicy: true,
        estimatedCostEth: '0.00025',
      });

      wallet._mockWait.mockResolvedValue({
        status: 1,
        gasUsed: 220000n,
        blockNumber: 12346,
      });

      const result = await adapter.submitLeg(plan, leg);

      expect(result).toEqual({ externalOrderId: '0xV3TxHash123' });
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // submitLeg — gas policy rejection
  // ─────────────────────────────────────────────────────────────────────

  describe('submitLeg — gas policy rejection', () => {
    it('should throw when gas exceeds policy', async () => {
      const plan = makePlan();
      const leg = makeLeg();
      const wallet = makeSelectedWallet();

      mockRpcProviderManager.getProvider.mockReturnValue(makeMockProvider());
      mockWalletManager.selectWallet.mockResolvedValue(wallet);
      mockTokenApprove.getAllowance.mockResolvedValue(10000000n);
      mockGasEstimator.estimateGas.mockResolvedValue({
        gasLimit: 250000n,
        feeData: {
          maxFeePerGas: 50000000000n,
          maxPriorityFeePerGas: 2000000000n,
        },
        withinPolicy: false,
        policyWarning: 'Gas price 50.00 GWEI exceeds policy max 30 GWEI',
        estimatedCostEth: '0.0125',
      });

      await expect(adapter.submitLeg(plan, leg)).rejects.toThrow('gas price exceeds policy');
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // submitLeg — tx reverted
  // ─────────────────────────────────────────────────────────────────────

  describe('submitLeg — tx reverted', () => {
    it('should throw VenueTerminalSubmitError when tx reverts on-chain', async () => {
      const plan = makePlan();
      const leg = makeLeg();
      const wallet = makeSelectedWallet();

      mockRpcProviderManager.getProvider.mockReturnValue(makeMockProvider());
      mockWalletManager.selectWallet.mockResolvedValue(wallet);
      mockTokenApprove.getAllowance.mockResolvedValue(10000000n);
      mockGasEstimator.estimateGas.mockResolvedValue({
        gasLimit: 250000n,
        feeData: { maxFeePerGas: 1000000000n, maxPriorityFeePerGas: 100000000n },
        withinPolicy: true,
        estimatedCostEth: '0.00025',
      });

      wallet._mockWait.mockResolvedValue({
        status: 0,
        gasUsed: 220000n,
        blockNumber: 12346,
      });

      await expect(adapter.submitLeg(plan, leg)).rejects.toThrow('reverted on-chain');
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // submitLeg — null receipt
  // ─────────────────────────────────────────────────────────────────────

  describe('submitLeg — null receipt', () => {
    it('should throw VenueSubmitTransientError when receipt is null', async () => {
      const plan = makePlan();
      const leg = makeLeg();
      const wallet = makeSelectedWallet();

      mockRpcProviderManager.getProvider.mockReturnValue(makeMockProvider());
      mockWalletManager.selectWallet.mockResolvedValue(wallet);
      mockTokenApprove.getAllowance.mockResolvedValue(10000000n);
      mockGasEstimator.estimateGas.mockResolvedValue({
        gasLimit: 250000n,
        feeData: { maxFeePerGas: 1000000000n, maxPriorityFeePerGas: 100000000n },
        withinPolicy: true,
        estimatedCostEth: '0.00025',
      });

      wallet._mockWait.mockResolvedValue(null);

      await expect(adapter.submitLeg(plan, leg)).rejects.toThrow('null receipt');
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // submitLeg — unexpected error
  // ─────────────────────────────────────────────────────────────────────

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
});