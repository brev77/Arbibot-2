import { Test } from '@nestjs/testing';
import { getArbibotMetricsRegistry } from '@arbibot/nest-platform';

import type { BridgeStatusContext, BridgeTransferParams } from './bridge-adapter.interface';
import { StargateBridgeAdapter } from './stargate-bridge.adapter';
import { RpcProviderManager } from '../rpc/rpc-provider-manager.service';
import { WalletManagerService } from '../wallet-manager.service';
import { GasEstimatorService } from '../gas/gas-estimator.service';
import { TokenApproveService } from '../token/token-approve.service';
import { BridgeFinalityService } from './bridge-finality.service';

// ───────────────────────────────────────────────────────────────────────
// Tests
// ───────────────────────────────────────────────────────────────────────

describe('StargateBridgeAdapter', () => {
  let adapter: StargateBridgeAdapter;

  const mockGetProvider = jest.fn();
  const mockSelectWallet = jest.fn();
  const mockEstimateGas = jest.fn();
  const mockGetAllowance = jest.fn();
  const mockApproveToken = jest.fn();
  const mockFinalityGetSourceConfirmations = jest.fn().mockResolvedValue(5);
  const mockFinalityRequired = jest.fn().mockReturnValue(1);

  const defaultParams: BridgeTransferParams = {
    sourceChainId: 42161, // Arbitrum
    destinationChainId: 8453, // Base
    token: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1', // WETH Arbitrum (valid checksum)
    destinationToken: '0x4200000000000000000000000000000000000006', // WETH Base
    amount: 1000000000000000000n,
    recipientAddress: '0x1234567890123456789012345678901234567890',
    idempotencyKey: 'test-plan:1:stargate',
  };

  const defaultStatusCtx: BridgeStatusContext = {
    bridgeId: '0xstargatetxhash:0',
    sourceChainId: 42161,
    destinationChainId: 8453,
    sourceTxHash: '0xstargatetxhash',
    amount: '1000000000000000000',
    token: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',
    destinationToken: '0x4200000000000000000000000000000000000006',
    recipientAddress: '0x1234567890123456789012345678901234567890',
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    getArbibotMetricsRegistry().clear();

    // Default: sufficient allowance, no approval needed
    mockGetAllowance.mockResolvedValue(999999999999999999999n);
    // Default: approval succeeds if called
    mockApproveToken.mockResolvedValue({
      status: 'success',
      txHash: '0xapprovehash',
    });
    mockEstimateGas.mockResolvedValue({
      withinPolicy: true,
      gasLimit: 350000n,
      feeData: {
        maxFeePerGas: 100000000n,
        maxPriorityFeePerGas: 1000000n,
      },
      estimatedCostEth: '0.0001',
    });
    mockSelectWallet.mockResolvedValue({
      address: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1',
      wallet: {
        sendTransaction: jest.fn().mockResolvedValue({
          hash: '0xstargatetxhash',
          wait: jest.fn().mockResolvedValue({
            status: 1,
            gasUsed: 250000n,
            blockNumber: 12345,
            logs: [],
          }),
        }),
      },
    });
    mockFinalityGetSourceConfirmations.mockResolvedValue(5);
    mockFinalityRequired.mockReturnValue(1);
    mockGetProvider.mockReturnValue({
      getBlockNumber: jest.fn().mockResolvedValue(100),
      getTransactionReceipt: jest.fn().mockResolvedValue(null),
    });

    const module = await Test.createTestingModule({
      providers: [
        StargateBridgeAdapter,
        { provide: RpcProviderManager, useValue: { getProvider: mockGetProvider } },
        { provide: WalletManagerService, useValue: { selectWallet: mockSelectWallet } },
        { provide: GasEstimatorService, useValue: { estimateGas: mockEstimateGas } },
        { provide: TokenApproveService, useValue: { getAllowance: mockGetAllowance, approveToken: mockApproveToken } },
        {
          provide: BridgeFinalityService,
          useValue: {
            getSourceConfirmations: mockFinalityGetSourceConfirmations,
            getRequiredConfirmationsFor: mockFinalityRequired,
          },
        },
      ],
    }).compile();

    adapter = module.get(StargateBridgeAdapter);
  });

  describe('properties', () => {
    it('should have correct bridgeKey', () => {
      expect(adapter.bridgeKey).toBe('stargate');
    });

    it('should have supported chains', () => {
      expect(adapter.supportedChains.length).toBeGreaterThan(0);
    });

    it('should include Arbitrum → Base as supported', () => {
      const hasArbToBase = adapter.supportedChains.some(
        ([src, dst]) => src === 42161 && dst === 8453,
      );
      expect(hasArbToBase).toBe(true);
    });
  });

  describe('estimateRelayTime', () => {
    it('should return default relay time (600s for Stargate/LayerZero)', async () => {
      const ms = await adapter.estimateRelayTime(defaultParams);
      expect(ms).toBe(600_000);
    });
  });

  describe('estimateBridgeFee', () => {
    it('should return fee estimate structure', async () => {
      const fee = await adapter.estimateBridgeFee(defaultParams);
      expect(fee).toHaveProperty('bridgeFee');
      expect(fee).toHaveProperty('relayerFee');
      expect(fee).toHaveProperty('estimatedGasSource');
      expect(fee).toHaveProperty('estimatedGasDestination');
      expect(fee).toHaveProperty('totalEstimatedCostUsd');
    });

    it('should return non-zero estimated gas for source', async () => {
      const fee = await adapter.estimateBridgeFee(defaultParams);
      expect(fee.estimatedGasSource).toBeGreaterThan(0n);
    });
  });

  describe('checkBridgeStatus', () => {
    it('should return pending when source not finalized (L5)', async () => {
      mockFinalityGetSourceConfirmations.mockResolvedValueOnce(0);

      const result = await adapter.checkBridgeStatus(defaultStatusCtx);

      expect(result.status).toBe('pending');
      expect(result.destinationTxHash).toBeNull();
    });

    it('should hold confirming when guid cannot be recovered (fail-closed, L5)', async () => {
      // Source finalized, but PacketSent event not found in the receipt → cannot
      // verify delivery. Capital-safe: hold 'confirming' (operator manual completion).
      const result = await adapter.checkBridgeStatus(defaultStatusCtx);

      // getTransactionReceipt returns null → guid null → 'confirming'.
      expect(result.status).toBe('confirming');
      expect(result.destinationTxHash).toBeNull();
    });
  });

  describe('submitBridgeTransfer', () => {
    it('should submit and return result with tx hash', async () => {
      const result = await adapter.submitBridgeTransfer(defaultParams);

      expect(result).toHaveProperty('sourceTxHash');
      expect(result).toHaveProperty('sourceChainId', 42161);
      expect(result).toHaveProperty('destinationChainId', 8453);
      expect(result).toHaveProperty('bridgeId');
      expect(result).toHaveProperty('estimatedRelayMs', 600_000);
    });

    it('should throw on unsupported chain pair', async () => {
      const badParams = {
        ...defaultParams,
        sourceChainId: 99999,
        destinationChainId: 88888,
      };

      await expect(adapter.submitBridgeTransfer(badParams)).rejects.toThrow(
        'unsupported chain pair',
      );
    });

    it('should throw when gas exceeds policy', async () => {
      mockGetAllowance.mockResolvedValue(999999999999999999999n);
      mockEstimateGas.mockResolvedValue({
        withinPolicy: false,
        gasLimit: 350000n,
        policyWarning: 'gas too high',
      });

      await expect(adapter.submitBridgeTransfer(defaultParams)).rejects.toThrow(
        'gas price exceeds policy',
      );
    });

    it('should approve tokens when allowance insufficient', async () => {
      mockGetAllowance.mockResolvedValueOnce(0n);
      mockApproveToken.mockResolvedValueOnce({
        status: 'success',
        txHash: '0xapprovehash',
      });

      const result = await adapter.submitBridgeTransfer(defaultParams);

      expect(mockApproveToken).toHaveBeenCalled();
      expect(result).toHaveProperty('sourceTxHash');
    });

    it('should throw when approval fails', async () => {
      mockGetAllowance.mockResolvedValueOnce(0n);
      mockApproveToken.mockResolvedValueOnce({
        status: 'failed',
        txHash: '0xapprovehash',
      });

      await expect(adapter.submitBridgeTransfer(defaultParams)).rejects.toThrow(
        'ERC20 approve failed',
      );
    });

    it('should throw when tx is reverted', async () => {
      mockSelectWallet.mockResolvedValue({
        address: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1',
        wallet: {
          sendTransaction: jest.fn().mockResolvedValue({
            hash: '0xrevertedhash',
            wait: jest.fn().mockResolvedValue({
              status: 0,
              gasUsed: 250000n,
              blockNumber: 12345,
              logs: [],
            }),
          }),
        },
      });

      await expect(adapter.submitBridgeTransfer(defaultParams)).rejects.toThrow(
        'reverted on source chain',
      );
    });
  });
});