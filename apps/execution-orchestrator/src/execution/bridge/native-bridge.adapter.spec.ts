import { Test } from '@nestjs/testing';
import { ZeroAddress } from 'ethers';
import { getArbibotMetricsRegistry } from '@arbibot/nest-platform';

import type { BridgeTransferParams } from './bridge-adapter.interface';
import { NativeBridgeAdapter } from './native-bridge.adapter';
import { RpcProviderManager } from '../rpc/rpc-provider-manager.service';
import { WalletManagerService } from '../wallet-manager.service';
import { GasEstimatorService } from '../gas/gas-estimator.service';
import { TokenApproveService } from '../token/token-approve.service';

// ───────────────────────────────────────────────────────────────────────
// Tests
// ───────────────────────────────────────────────────────────────────────

describe('NativeBridgeAdapter', () => {
  let adapter: NativeBridgeAdapter;

  const mockGetProvider = jest.fn();
  const mockSelectWallet = jest.fn();
  const mockEstimateGas = jest.fn();
  const mockGetAllowance = jest.fn();
  const mockApproveToken = jest.fn();

  /** ETH → Arbitrum (Arbitrum Inbox deposit) */
  const ethToArbParams: BridgeTransferParams = {
    sourceChainId: 1, // Ethereum
    destinationChainId: 42161, // Arbitrum
    token: ZeroAddress, // native ETH
    destinationToken: ZeroAddress,
    amount: 1000000000000000000n, // 1 ETH
    recipientAddress: '0x1234567890123456789012345678901234567890',
    idempotencyKey: 'test-plan:1:native',
  };

  /** ETH → Base (L1StandardBridge deposit) */
  const ethToBaseParams: BridgeTransferParams = {
    sourceChainId: 1, // Ethereum
    destinationChainId: 8453, // Base
    token: ZeroAddress, // native ETH
    destinationToken: ZeroAddress,
    amount: 1000000000000000000n,
    recipientAddress: '0x1234567890123456789012345678901234567890',
    idempotencyKey: 'test-plan:1:native-base',
  };

  /** Base → ETH (L2StandardBridge withdrawal) */
  const baseToEthParams: BridgeTransferParams = {
    sourceChainId: 8453, // Base
    destinationChainId: 1, // Ethereum
    token: ZeroAddress,
    destinationToken: ZeroAddress,
    amount: 1000000000000000000n,
    recipientAddress: '0x1234567890123456789012345678901234567890',
    idempotencyKey: 'test-plan:1:native-withdraw',
  };

  /** ERC20 ETH → Base (L1StandardBridge ERC20 deposit) */
  const erc20ToBaseParams: BridgeTransferParams = {
    sourceChainId: 1,
    destinationChainId: 8453,
    token: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', // WETH mainnet
    destinationToken: '0x4200000000000000000000000000000000000006', // WETH Base
    amount: 1000000000000000000n,
    recipientAddress: '0x1234567890123456789012345678901234567890',
    idempotencyKey: 'test-plan:1:native-erc20',
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    getArbibotMetricsRegistry().clear();

    // Default: sufficient allowance
    mockGetAllowance.mockResolvedValue(999999999999999999999n);
    mockApproveToken.mockResolvedValue({ status: 'success', txHash: '0xapprovehash' });

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
      keyId: 'test-key',
      address: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1',
      wallet: {
        sendTransaction: jest.fn().mockResolvedValue({
          hash: '0xnativetxhash',
          wait: jest.fn().mockResolvedValue({
            status: 1,
            gasUsed: 250000n,
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
        NativeBridgeAdapter,
        { provide: RpcProviderManager, useValue: { getProvider: mockGetProvider } },
        { provide: WalletManagerService, useValue: { selectWallet: mockSelectWallet } },
        { provide: GasEstimatorService, useValue: { estimateGas: mockEstimateGas } },
        { provide: TokenApproveService, useValue: { getAllowance: mockGetAllowance, approveToken: mockApproveToken } },
      ],
    }).compile();

    adapter = module.get(NativeBridgeAdapter);
  });

  // ─────────────────────────────────────────────────────────────────────
  // Properties
  // ─────────────────────────────────────────────────────────────────────

  describe('properties', () => {
    it('should have correct bridgeKey', () => {
      expect(adapter.bridgeKey).toBe('native');
    });

    it('should have supported chains', () => {
      expect(adapter.supportedChains.length).toBeGreaterThan(0);
    });

    it('should include ETH → Arbitrum as supported', () => {
      const has = adapter.supportedChains.some(([s, d]) => s === 1 && d === 42161);
      expect(has).toBe(true);
    });

    it('should include ETH → Base as supported', () => {
      const has = adapter.supportedChains.some(([s, d]) => s === 1 && d === 8453);
      expect(has).toBe(true);
    });

    it('should include Base → ETH as supported', () => {
      const has = adapter.supportedChains.some(([s, d]) => s === 8453 && d === 1);
      expect(has).toBe(true);
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // estimateRelayTime
  // ─────────────────────────────────────────────────────────────────────

  describe('estimateRelayTime', () => {
    it('should return 10 min for L1→L2 (ETH→Arbitrum)', async () => {
      const ms = await adapter.estimateRelayTime(ethToArbParams);
      expect(ms).toBe(600_000);
    });

    it('should return 7 days for L2→L1 (Base→ETH)', async () => {
      const ms = await adapter.estimateRelayTime(baseToEthParams);
      expect(ms).toBe(604_800_000);
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // estimateBridgeFee
  // ─────────────────────────────────────────────────────────────────────

  describe('estimateBridgeFee', () => {
    it('should return zero protocol fee for native bridges', async () => {
      const fee = await adapter.estimateBridgeFee(ethToArbParams);
      expect(fee.bridgeFee).toBe(0n);
      expect(fee.relayerFee).toBe(0n);
    });

    it('should return correct gas estimate for Arbitrum inbox', async () => {
      const fee = await adapter.estimateBridgeFee(ethToArbParams);
      expect(fee.estimatedGasSource).toBe(200_000n);
    });

    it('should return correct gas estimate for L1StandardBridge', async () => {
      const fee = await adapter.estimateBridgeFee(ethToBaseParams);
      expect(fee.estimatedGasSource).toBe(150_000n);
    });

    it('should return correct gas estimate for L2StandardBridge', async () => {
      const fee = await adapter.estimateBridgeFee(baseToEthParams);
      expect(fee.estimatedGasSource).toBe(100_000n);
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // checkBridgeStatus
  // ─────────────────────────────────────────────────────────────────────

  describe('checkBridgeStatus', () => {
    it('should return pending status (stub)', async () => {
      const result = await adapter.checkBridgeStatus('native-123');
      expect(result.status).toBe('pending');
      expect(result).toHaveProperty('estimatedCompletionMs');
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // submitBridgeTransfer
  // ─────────────────────────────────────────────────────────────────────

  describe('submitBridgeTransfer', () => {
    it('should submit ETH→Arbitrum deposit via Inbox', async () => {
      const result = await adapter.submitBridgeTransfer(ethToArbParams);

      expect(result).toHaveProperty('sourceTxHash');
      expect(result).toHaveProperty('sourceChainId', 1);
      expect(result).toHaveProperty('destinationChainId', 42161);
      expect(result).toHaveProperty('bridgeId');
      expect(result).toHaveProperty('estimatedRelayMs', 600_000);
    });

    it('should submit ETH→Base deposit via L1StandardBridge', async () => {
      const result = await adapter.submitBridgeTransfer(ethToBaseParams);

      expect(result).toHaveProperty('sourceTxHash');
      expect(result.sourceChainId).toBe(1);
      expect(result.destinationChainId).toBe(8453);
      expect(result.estimatedRelayMs).toBe(600_000);
    });

    it('should submit Base→ETH withdrawal via L2StandardBridge with 7-day estimate', async () => {
      const result = await adapter.submitBridgeTransfer(baseToEthParams);

      expect(result).toHaveProperty('sourceTxHash');
      expect(result.estimatedRelayMs).toBe(604_800_000); // 7 days
    });

    it('should throw on unsupported chain pair (Arb→Base not native)', async () => {
      const badParams: BridgeTransferParams = {
        sourceChainId: 42161, // Arbitrum
        destinationChainId: 8453, // Base — not supported by native bridges
        token: ZeroAddress,
        destinationToken: ZeroAddress,
        amount: 1000000000000000000n,
        recipientAddress: '0x1234567890123456789012345678901234567890',
        idempotencyKey: 'test-bad',
      };

      await expect(adapter.submitBridgeTransfer(badParams)).rejects.toThrow(
        'unsupported chain pair',
      );
    });

    it('should throw when gas exceeds policy', async () => {
      mockEstimateGas.mockResolvedValue({
        withinPolicy: false,
        gasLimit: 350000n,
        policyWarning: 'gas too high',
      });

      await expect(adapter.submitBridgeTransfer(ethToArbParams)).rejects.toThrow(
        'gas price exceeds policy',
      );
    });

    it('should throw when Arbitrum Inbox receives ERC20', async () => {
      const erc20ArbParams: BridgeTransferParams = {
        sourceChainId: 1,
        destinationChainId: 42161,
        token: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', // WETH
        destinationToken: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',
        amount: 1000000000000000000n,
        recipientAddress: '0x1234567890123456789012345678901234567890',
        idempotencyKey: 'test-erc20-arb',
      };

      await expect(adapter.submitBridgeTransfer(erc20ArbParams)).rejects.toThrow(
        'ERC20 deposits via Inbox not supported',
      );
    });

    it('should approve ERC20 tokens when allowance insufficient (L1StandardBridge)', async () => {
      mockGetAllowance.mockResolvedValueOnce(0n);
      mockApproveToken.mockResolvedValueOnce({ status: 'success', txHash: '0xapprovehash' });

      const result = await adapter.submitBridgeTransfer(erc20ToBaseParams);

      expect(mockApproveToken).toHaveBeenCalled();
      expect(result).toHaveProperty('sourceTxHash');
    });

    it('should throw when ERC20 approval fails', async () => {
      mockGetAllowance.mockResolvedValueOnce(0n);
      mockApproveToken.mockResolvedValueOnce({ status: 'failed', txHash: '0xapprovehash' });

      await expect(adapter.submitBridgeTransfer(erc20ToBaseParams)).rejects.toThrow(
        'ERC20 approve failed',
      );
    });

    it('should throw when tx is reverted', async () => {
      mockSelectWallet.mockResolvedValue({
        keyId: 'test-key',
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

      await expect(adapter.submitBridgeTransfer(ethToArbParams)).rejects.toThrow(
        'reverted on source chain',
      );
    });
  });
});