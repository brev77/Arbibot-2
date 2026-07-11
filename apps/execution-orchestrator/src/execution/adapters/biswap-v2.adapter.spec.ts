/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { getArbibotMetricsRegistry } from '@arbibot/nest-platform';

import { BiswapV2Adapter } from './biswap-v2.adapter';

// ───────────────────────────────────────────────────────────────────────
// BNB Chain addresses (from @arbibot/contracts-eth)
// ───────────────────────────────────────────────────────────────────────

const TOKEN_IN = '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c' as any;  // WBNB mainnet
const TOKEN_OUT = '0x55d398326f99059fF775485246999027B3197955' as any;  // USDT mainnet
const BISWAP_V2_ROUTER_MAINNET = '0x3a6d8cA8D9C0a3E4585c2a2c84D7A36e0301A4E';
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

// Helper: create a minimal plan entity with BNB mainnet swap params
function makePlan(overrides: Partial<{
  id: string;
  playbookConfig: Record<string, unknown> | null;
}> = {}): any {
  return {
    id: overrides.id ?? 'plan-bnb-biswap-001',
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
              chainId: 56, // BNB mainnet (Biswap is mainnet-only)
              tokenIn: TOKEN_IN,
              tokenOut: TOKEN_OUT,
              amountIn: '1000000000000000000', // 1 WBNB
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
    id: overrides.id ?? 'leg-bnb-biswap-001',
    planId: 'plan-bnb-biswap-001',
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
    hash: '0xBiswapTxHash',
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

describe('BiswapV2Adapter', () => {
  let adapter: BiswapV2Adapter;

  beforeEach(() => {
    getArbibotMetricsRegistry().clear();
    jest.clearAllMocks();

    adapter = new BiswapV2Adapter(
      mockRpcProviderManager as any,
      mockWalletManager as any,
      mockGasEstimator as any,
      mockTokenApprove as any,
    );
  });

  // ─────────────────────────────────────────────────────────────────────
  // buildSwapTxRequest
  // ─────────────────────────────────────────────────────────────────────

  describe('buildSwapTxRequest', () => {
    it('should encode swapExactTokensForTokens for Biswap V2 router (mainnet)', () => {
      const result = adapter.buildSwapTxRequest(
        BISWAP_V2_ROUTER_MAINNET,
        '1000000000000000000',
        '599000000',
        [TOKEN_IN, TOKEN_OUT],
        RECIPIENT,
        9999999999,
        FROM,
      );

      expect(result.to).toBe(BISWAP_V2_ROUTER_MAINNET);
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
      const plan = makePlan({ playbookConfig: { dexSwaps: 'invalid' } });
      const leg = makeLeg();

      await expect(adapter.submitLeg(plan, leg)).rejects.toThrow('dexSwaps is not an array');
    });

    it('should throw when dexSwaps[legIndex] is missing', async () => {
      const plan = makePlan({ playbookConfig: { dexSwaps: [] } });
      const leg = makeLeg({ legIndex: 0 });

      await expect(adapter.submitLeg(plan, leg)).rejects.toThrow('no swap params at dexSwaps[0]');
    });

    it('should throw for BNB testnet (chainId=97) — Biswap not deployed', async () => {
      const plan = makePlan({
        playbookConfig: {
          dexSwaps: [{
            chainId: 97, // BNB testnet — Biswap not deployed here
            tokenIn: TOKEN_IN,
            tokenOut: TOKEN_OUT,
            amountIn: '1000',
          }],
        },
      });
      const leg = makeLeg();

      mockRpcProviderManager.getProvider.mockReturnValue(makeMockProvider());

      await expect(adapter.submitLeg(plan, leg)).rejects.toThrow(
        'Biswap is not deployed on BNB testnet',
      );
    });

    it('should throw for unsupported chainId (non-BNB)', async () => {
      const plan = makePlan({
        playbookConfig: {
          dexSwaps: [{
            chainId: 42161, // Arbitrum
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

    it('should throw for completely unknown chainId', async () => {
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
      chainId: 56 as any,
      tokenIn: TOKEN_IN,
      tokenOut: TOKEN_OUT,
      amountIn: '1000000000000000000',
    };

    it('should skip approval when allowance is sufficient', async () => {
      const wallet = makeSelectedWallet();
      mockTokenApprove.getAllowance.mockResolvedValue(2000000000000000000n);

      await adapter.ensureApproval(params, wallet as any, BISWAP_V2_ROUTER_MAINNET);

      expect(mockTokenApprove.approveToken).not.toHaveBeenCalled();
    });

    it('should approve when allowance is insufficient', async () => {
      const wallet = makeSelectedWallet();
      mockTokenApprove.getAllowance.mockResolvedValue(500n);
      mockTokenApprove.approveToken.mockResolvedValue({
        status: 'confirmed',
        txHash: '0xApproveTxHash',
      });

      await adapter.ensureApproval(params, wallet as any, BISWAP_V2_ROUTER_MAINNET);

      expect(mockTokenApprove.approveToken).toHaveBeenCalledWith({
        chainId: params.chainId,
        tokenAddress: params.tokenIn,
        spender: BISWAP_V2_ROUTER_MAINNET,
        amount: 1000000000000000000n,
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
        adapter.ensureApproval(params, wallet as any, BISWAP_V2_ROUTER_MAINNET as any),
      ).rejects.toThrow('ERC20 approve failed');
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // submitLeg — success flow (BNB mainnet, chainId=56)
  // ─────────────────────────────────────────────────────────────────────

  describe('submitLeg — success flow (mainnet only)', () => {
    it('should return externalOrderId on successful swap (chainId=56)', async () => {
      const plan = makePlan(); // chainId 56 by default
      const leg = makeLeg();
      const wallet = makeSelectedWallet();

      mockRpcProviderManager.getProvider.mockReturnValue(makeMockProvider());
      mockWalletManager.selectWallet.mockResolvedValue(wallet);
      mockTokenApprove.getAllowance.mockResolvedValue(2000000000000000000n);
      mockGasEstimator.estimateGas.mockResolvedValue({
        gasLimit: 220000n,
        feeData: {
          maxFeePerGas: 3000000000n, // 3 GWEI
          maxPriorityFeePerGas: 500000000n,
        },
        withinPolicy: true,
        estimatedCostEth: '0.00066',
      });

      const spy = jest.spyOn(adapter, 'calculateAmountOutMin').mockResolvedValue('599000000');

      wallet._mockWait.mockResolvedValue({
        status: 1,
        gasUsed: 195000n,
        blockNumber: 34567890,
      });

      const result = await adapter.submitLeg(plan, leg);

      expect(result).toEqual({ externalOrderId: '0xBiswapTxHash' });
      expect(mockWalletManager.selectWallet).toHaveBeenCalledWith(
        56,
        expect.anything(),
        TOKEN_IN,
        1000000000000000000n,
      );
      expect(spy).toHaveBeenCalled();

      spy.mockRestore();
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
      mockTokenApprove.getAllowance.mockResolvedValue(2000000000000000000n);
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

      const spy = jest.spyOn(adapter, 'calculateAmountOutMin').mockResolvedValue('599000000');

      await expect(adapter.submitLeg(plan, leg)).rejects.toThrow('gas price exceeds policy');

      spy.mockRestore();
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // submitLeg — tx reverted
  // ─────────────────────────────────────────────────────────────────────

  describe('submitLeg — tx reverted', () => {
    it('should throw when tx reverts on-chain', async () => {
      const plan = makePlan();
      const leg = makeLeg();
      const wallet = makeSelectedWallet();

      mockRpcProviderManager.getProvider.mockReturnValue(makeMockProvider());
      mockWalletManager.selectWallet.mockResolvedValue(wallet);
      mockTokenApprove.getAllowance.mockResolvedValue(2000000000000000000n);
      mockGasEstimator.estimateGas.mockResolvedValue({
        gasLimit: 200000n,
        feeData: { maxFeePerGas: 1000000000n, maxPriorityFeePerGas: 100000000n },
        withinPolicy: true,
        estimatedCostEth: '0.0002',
      });

      const spy = jest.spyOn(adapter, 'calculateAmountOutMin').mockResolvedValue('599000000');

      wallet._mockWait.mockResolvedValue({
        status: 0,
        gasUsed: 180000n,
        blockNumber: 34567890,
      });

      await expect(adapter.submitLeg(plan, leg)).rejects.toThrow('reverted on-chain');

      spy.mockRestore();
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // submitLeg — null receipt
  // ─────────────────────────────────────────────────────────────────────

  describe('submitLeg — null receipt', () => {
    it('should throw when receipt is null', async () => {
      const plan = makePlan();
      const leg = makeLeg();
      const wallet = makeSelectedWallet();

      mockRpcProviderManager.getProvider.mockReturnValue(makeMockProvider());
      mockWalletManager.selectWallet.mockResolvedValue(wallet);
      mockTokenApprove.getAllowance.mockResolvedValue(2000000000000000000n);
      mockGasEstimator.estimateGas.mockResolvedValue({
        gasLimit: 200000n,
        feeData: { maxFeePerGas: 1000000000n, maxPriorityFeePerGas: 100000000n },
        withinPolicy: true,
        estimatedCostEth: '0.0002',
      });

      const spy = jest.spyOn(adapter, 'calculateAmountOutMin').mockResolvedValue('599000000');

      wallet._mockWait.mockResolvedValue(null);

      await expect(adapter.submitLeg(plan, leg)).rejects.toThrow('null receipt');

      spy.mockRestore();
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
