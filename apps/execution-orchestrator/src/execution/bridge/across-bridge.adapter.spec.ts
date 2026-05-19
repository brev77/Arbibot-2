import { Test } from '@nestjs/testing';
import { getArbibotMetricsRegistry } from '@arbibot/nest-platform';

import type { BridgeTransferParams } from './bridge-adapter.interface';
import { AcrossBridgeAdapter } from './across-bridge.adapter';
import { RpcProviderManager } from '../rpc/rpc-provider-manager.service';
import { WalletManagerService } from '../wallet-manager.service';
import { GasEstimatorService } from '../gas/gas-estimator.service';
import { TokenApproveService } from '../token/token-approve.service';

// ───────────────────────────────────────────────────────────────────────
// Tests
// ───────────────────────────────────────────────────────────────────────

describe('AcrossBridgeAdapter', () => {
  let adapter: AcrossBridgeAdapter;

  const mockGetProvider = jest.fn();
  const mockSelectWallet = jest.fn();
  const mockEstimateGas = jest.fn();
  const mockGetAllowance = jest.fn();
  const mockApproveToken = jest.fn();

  const defaultParams: BridgeTransferParams = {
    sourceChainId: 42161, // Arbitrum
    destinationChainId: 8453, // Base
    token: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1', // WETH Arbitrum (valid checksum)
    destinationToken: '0x4200000000000000000000000000000000000006', // WETH Base
    amount: 1000000000000000000n,
    recipientAddress: '0x1234567890123456789012345678901234567890',
    idempotencyKey: 'test-plan:1:across',
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
      gasLimit: 200000n,
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
          hash: '0xtxhash123',
          wait: jest.fn().mockResolvedValue({
            status: 1,
            gasUsed: 150000n,
            blockNumber: 12345,
            logs: [],
          }),
        }),
      },
    });
    mockGetProvider.mockReturnValue({
      getBlockNumber: jest.fn().mockResolvedValue(100),
    });

    const module = await Test.createTestingModule({
      providers: [
        AcrossBridgeAdapter,
        { provide: RpcProviderManager, useValue: { getProvider: mockGetProvider } },
        { provide: WalletManagerService, useValue: { selectWallet: mockSelectWallet } },
        { provide: GasEstimatorService, useValue: { estimateGas: mockEstimateGas } },
        { provide: TokenApproveService, useValue: { getAllowance: mockGetAllowance, approveToken: mockApproveToken } },
      ],
    }).compile();

    adapter = module.get(AcrossBridgeAdapter);
  });

  describe('properties', () => {
    it('should have correct bridgeKey', () => {
      expect(adapter.bridgeKey).toBe('across');
    });

    it('should have supported chains', () => {
      expect(adapter.supportedChains.length).toBeGreaterThan(0);
    });
  });

  describe('estimateRelayTime', () => {
    it('should return default relay time', async () => {
      const ms = await adapter.estimateRelayTime(defaultParams);
      expect(ms).toBe(240_000);
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
  });

  describe('checkBridgeStatus', () => {
    it('should return pending status (stub)', async () => {
      const result = await adapter.checkBridgeStatus('deposit-123');
      expect(result.status).toBe('pending');
      expect(result).toHaveProperty('estimatedCompletionMs');
    });
  });

  describe('submitBridgeTransfer', () => {
    it('should submit and return result with tx hash', async () => {
      const result = await adapter.submitBridgeTransfer(defaultParams);

      expect(result).toHaveProperty('sourceTxHash');
      expect(result).toHaveProperty('sourceChainId', 42161);
      expect(result).toHaveProperty('destinationChainId', 8453);
      expect(result).toHaveProperty('bridgeId');
      expect(result).toHaveProperty('estimatedRelayMs');
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
      // Allowance sufficient so ensureApproval passes quickly
      mockGetAllowance.mockResolvedValue(999999999999999999999n);
      mockEstimateGas.mockResolvedValue({
        withinPolicy: false,
        gasLimit: 200000n,
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
  });
});