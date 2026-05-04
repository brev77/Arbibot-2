/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeEach, afterAll, jest } from '@jest/globals';
import { getArbibotMetricsRegistry } from '@arbibot/nest-platform';

import { UniswapV2Adapter, applySlippage, getSlippageBps } from './uniswap-v2.adapter';

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

const mockGasEstimator: Record<string, any> = {
  estimateGas: jest.fn(),
};

const mockTokenApprove: Record<string, any> = {
  getAllowance: jest.fn(),
  approveToken: jest.fn(),
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

    adapter = new UniswapV2Adapter(
      mockRpcProviderManager as any,
      mockWalletManager as any,
      mockGasEstimator as any,
      mockTokenApprove as any,
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

    it('should throw when dexSwaps is not an array', async () => {
      const plan = makePlan({ playbookConfig: { dexSwaps: 'invalid' } as any });
      const leg = makeLeg();

      await expect(adapter.submitLeg(plan, leg)).rejects.toThrow('dexSwaps is not an array');
    });

    it('should throw when dexSwaps[legIndex] is missing', async () => {
      const plan = makePlan({ playbookConfig: { dexSwaps: [] } });
      const leg = makeLeg({ legIndex: 0 });

      await expect(adapter.submitLeg(plan, leg)).rejects.toThrow('no swap params at dexSwaps[0]');
    });

    it('should throw when required fields have wrong types', async () => {
      const plan = makePlan({
        playbookConfig: {
          dexSwaps: [{ chainId: 'not-a-number' }],
        },
      });
      const leg = makeLeg();

      await expect(adapter.submitLeg(plan, leg)).rejects.toThrow('invalid swap params');
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
      const spy = jest.spyOn(adapter, 'calculateAmountOutMin').mockResolvedValue('950000');

      wallet._mockWait.mockResolvedValue({
        status: 1,
        gasUsed: 180000n,
        blockNumber: 12345,
      });

      const result = await adapter.submitLeg(plan, leg);

      expect(result).toEqual({ externalOrderId: '0xTxHash123' });
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

      const spy = jest.spyOn(adapter, 'calculateAmountOutMin').mockResolvedValue('950000');

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

      const spy = jest.spyOn(adapter, 'calculateAmountOutMin').mockResolvedValue('950000');

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

      const spy = jest.spyOn(adapter, 'calculateAmountOutMin').mockResolvedValue('950000');

      wallet._mockWait.mockResolvedValue(null);

      await expect(adapter.submitLeg(plan, leg)).rejects.toThrow('null receipt');

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
});