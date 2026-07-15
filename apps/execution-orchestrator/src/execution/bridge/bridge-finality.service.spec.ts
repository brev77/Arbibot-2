import { Test } from '@nestjs/testing';
import { getArbibotMetricsRegistry } from '@arbibot/nest-platform';
import { ChainId, getRequiredConfirmations } from '@arbibot/contracts-eth';

import { BridgeFinalityService } from './bridge-finality.service';
import { RpcProviderManager } from '../rpc/rpc-provider-manager.service';

describe('BridgeFinalityService', () => {
  let service: BridgeFinalityService;

  const mockGetProvider = jest.fn();

  beforeEach(async () => {
    jest.clearAllMocks();
    getArbibotMetricsRegistry().clear();
    delete process.env.BRIDGE_FINALITY_CONFIRMATIONS;

    const module = await Test.createTestingModule({
      providers: [
        BridgeFinalityService,
        { provide: RpcProviderManager, useValue: { getProvider: mockGetProvider } },
      ],
    }).compile();

    service = module.get(BridgeFinalityService);
  });

  afterEach(() => {
    delete process.env.BRIDGE_FINALITY_CONFIRMATIONS;
  });

  describe('getRequiredConfirmationsFor', () => {
    it('should return chain-specific defaults (ETH mainnet = 12)', () => {
      expect(service.getRequiredConfirmationsFor(ChainId.ETHEREUM_MAINNET)).toBe(12);
    });

    it('should return L2 rollup default = 1 (Arbitrum, Base)', () => {
      expect(service.getRequiredConfirmationsFor(ChainId.ARBITRUM_ONE_MAINNET)).toBe(1);
      expect(service.getRequiredConfirmationsFor(ChainId.BASE_MAINNET)).toBe(1);
    });

    it('should return BNB Chain default = 15', () => {
      expect(service.getRequiredConfirmationsFor(ChainId.BNB_CHAIN_MAINNET)).toBe(15);
    });

    it('should apply env override when present (tighten only)', async () => {
      process.env.BRIDGE_FINALITY_CONFIRMATIONS = '{"1":20,"42161":2}';
      getArbibotMetricsRegistry().clear();
      const module = await Test.createTestingModule({
        providers: [
          BridgeFinalityService,
          { provide: RpcProviderManager, useValue: { getProvider: mockGetProvider } },
        ],
      }).compile();
      const svc = module.get(BridgeFinalityService);

      expect(svc.getRequiredConfirmationsFor(ChainId.ETHEREUM_MAINNET)).toBe(20);
      expect(svc.getRequiredConfirmationsFor(ChainId.ARBITRUM_ONE_MAINNET)).toBe(2);
    });

    it('should clamp env override to ≥ chain default (cannot loosen)', async () => {
      // Try to set ETH confirmations to 5 (< default 12) — must be clamped to 12.
      process.env.BRIDGE_FINALITY_CONFIRMATIONS = '{"1":5}';
      getArbibotMetricsRegistry().clear();
      const module = await Test.createTestingModule({
        providers: [
          BridgeFinalityService,
          { provide: RpcProviderManager, useValue: { getProvider: mockGetProvider } },
        ],
      }).compile();
      const svc = module.get(BridgeFinalityService);

      expect(svc.getRequiredConfirmationsFor(ChainId.ETHEREUM_MAINNET)).toBe(12);
    });

    it('should fall back to defaults on malformed env (fail-closed)', async () => {
      process.env.BRIDGE_FINALITY_CONFIRMATIONS = 'not-json';
      getArbibotMetricsRegistry().clear();
      const module = await Test.createTestingModule({
        providers: [
          BridgeFinalityService,
          { provide: RpcProviderManager, useValue: { getProvider: mockGetProvider } },
        ],
      }).compile();
      const svc = module.get(BridgeFinalityService);

      expect(svc.getRequiredConfirmationsFor(ChainId.ETHEREUM_MAINNET)).toBe(12);
    });

    it('should return conservative default for unknown chain', () => {
      expect(service.getRequiredConfirmationsFor(99999)).toBe(getRequiredConfirmations(99999));
    });
  });

  describe('getSourceConfirmations', () => {
    it('should return 0 for empty tx hash', async () => {
      const conf = await service.getSourceConfirmations('', ChainId.ARBITRUM_ONE_MAINNET);
      expect(conf).toBe(0);
    });

    it('should compute confirmations from receipt + current block', async () => {
      mockGetProvider.mockReturnValue({
        getTransactionReceipt: jest.fn().mockResolvedValue({ blockNumber: 100 }),
        getBlockNumber: jest.fn().mockResolvedValue(110),
      });

      const conf = await service.getSourceConfirmations('0xabc', ChainId.ARBITRUM_ONE_MAINNET);
      expect(conf).toBe(10);
    });

    it('should return 0 when receipt not mined yet (null)', async () => {
      mockGetProvider.mockReturnValue({
        getTransactionReceipt: jest.fn().mockResolvedValue(null),
        getBlockNumber: jest.fn().mockResolvedValue(110),
      });

      const conf = await service.getSourceConfirmations('0xabc', ChainId.ARBITRUM_ONE_MAINNET);
      expect(conf).toBe(0);
    });

    it('should fail-closed (return 0) on RPC error', async () => {
      mockGetProvider.mockReturnValue({
        getTransactionReceipt: jest.fn().mockRejectedValue(new Error('RPC down')),
        getBlockNumber: jest.fn().mockResolvedValue(110),
      });

      const conf = await service.getSourceConfirmations('0xabc', ChainId.ARBITRUM_ONE_MAINNET);
      expect(conf).toBe(0);
    });
  });

  describe('waitForSourceFinality', () => {
    it('should timeout when tx hash is empty', async () => {
      const result = await service.waitForSourceFinality('', ChainId.ARBITRUM_ONE_MAINNET);

      expect(result.confirmed).toBe(false);
      expect(result.timedOut).toBe(true);
    });

    it('should confirm when waitForTransaction returns a receipt', async () => {
      mockGetProvider.mockReturnValue({
        waitForTransaction: jest.fn().mockResolvedValue({ blockNumber: 100, status: 1 }),
        getBlockNumber: jest.fn().mockResolvedValue(110),
      });

      const result = await service.waitForSourceFinality('0xabc', ChainId.ARBITRUM_ONE_MAINNET);

      expect(result.confirmed).toBe(true);
      expect(result.timedOut).toBe(false);
      expect(result.confirmations).toBe(10);
    });

    it('should timeout when waitForTransaction returns null', async () => {
      mockGetProvider.mockReturnValue({
        waitForTransaction: jest.fn().mockResolvedValue(null),
        getBlockNumber: jest.fn().mockResolvedValue(110),
      });

      const result = await service.waitForSourceFinality('0xabc', ChainId.ARBITRUM_ONE_MAINNET, 1000);

      expect(result.confirmed).toBe(false);
      expect(result.timedOut).toBe(true);
    });

    it('should fail-closed (timeout) on RPC error', async () => {
      mockGetProvider.mockReturnValue({
        waitForTransaction: jest.fn().mockRejectedValue(new Error('RPC timeout')),
        getBlockNumber: jest.fn().mockResolvedValue(110),
      });

      const result = await service.waitForSourceFinality('0xabc', ChainId.ARBITRUM_ONE_MAINNET, 1000);

      expect(result.confirmed).toBe(false);
      expect(result.timedOut).toBe(true);
    });
  });
});
