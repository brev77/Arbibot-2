import { Test, TestingModule } from '@nestjs/testing';
import { getArbibotMetricsRegistry } from '@arbibot/nest-platform';

import { GasEstimatorService, Eip1559FeeData } from './gas-estimator.service';
import { RpcProviderManager } from '../rpc/rpc-provider-manager.service';

// Clear metrics registry between tests
function clearRegistry() {
  try {
    getArbibotMetricsRegistry().clear();
  } catch {
    // ignore if already cleared
  }
}

describe('GasEstimatorService', () => {
  let service: GasEstimatorService;
  let rpcManager: Partial<RpcProviderManager>;

  // Mock provider
  const mockProvider = {
    getFeeData: jest.fn(),
    getBlock: jest.fn(),
    estimateGas: jest.fn(),
  };

  beforeEach(async () => {
    clearRegistry();

    rpcManager = {
      getProvider: jest.fn().mockReturnValue(mockProvider),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GasEstimatorService,
        { provide: RpcProviderManager, useValue: rpcManager },
      ],
    }).compile();

    service = module.get<GasEstimatorService>(GasEstimatorService);

    // Reset env
    delete process.env.MAX_GAS_PRICE_GWEI;
    delete process.env.MAX_PRIORITY_FEE_GWEI;
    delete process.env.GAS_LIMIT_MULTIPLIER;
    delete process.env.GAS_REJECT_ON_EXCEED;
    delete process.env['GAS_POLICY_42161_MAX_FEE_GWEI'];
    delete process.env['GAS_POLICY_42161_MAX_PRIORITY_FEE_GWEI'];
  });

  afterEach(() => {
    clearRegistry();
  });

  describe('getGasPolicy', () => {
    it('should return default policy when no env vars set', () => {
      const policy = service.getGasPolicy(42161);
      expect(policy.maxFeePerGasGwei).toBe(50);
      expect(policy.maxPriorityFeeGwei).toBe(2);
      expect(policy.gasLimitMultiplier).toBe(1.15);
      expect(policy.rejectOnExceed).toBe(true);
    });

    it('should use global env vars when set', () => {
      process.env.MAX_GAS_PRICE_GWEI = '100';
      process.env.MAX_PRIORITY_FEE_GWEI = '5';
      process.env.GAS_LIMIT_MULTIPLIER = '1.2';
      process.env.GAS_REJECT_ON_EXCEED = 'false';

      const policy = service.getGasPolicy(42161);
      expect(policy.maxFeePerGasGwei).toBe(100);
      expect(policy.maxPriorityFeeGwei).toBe(5);
      expect(policy.gasLimitMultiplier).toBe(1.2);
      expect(policy.rejectOnExceed).toBe(false);
    });

    it('should use per-chain overrides over global defaults', () => {
      process.env.MAX_GAS_PRICE_GWEI = '100';
      process.env['GAS_POLICY_42161_MAX_FEE_GWEI'] = '200';
      process.env['GAS_POLICY_42161_MAX_PRIORITY_FEE_GWEI'] = '10';

      const policy = service.getGasPolicy(42161);
      expect(policy.maxFeePerGasGwei).toBe(200);
      expect(policy.maxPriorityFeeGwei).toBe(10);
    });

    it('should use global defaults for chains without per-chain override', () => {
      process.env.MAX_GAS_PRICE_GWEI = '80';
      process.env['GAS_POLICY_42161_MAX_FEE_GWEI'] = '200';

      const policyArbitrum = service.getGasPolicy(42161);
      expect(policyArbitrum.maxFeePerGasGwei).toBe(200);

      const policyBase = service.getGasPolicy(8453);
      expect(policyBase.maxFeePerGasGwei).toBe(80);
    });
  });

  describe('getEip1559FeeData', () => {
    it('should return EIP-1559 fee data from provider', async () => {
      const GWEI = 1_000_000_000n;
      mockProvider.getFeeData.mockResolvedValue({
        maxFeePerGas: 30n * GWEI,
        maxPriorityFeePerGas: 2n * GWEI,
        gasPrice: 20n * GWEI,
      });
      mockProvider.getBlock.mockResolvedValue({
        baseFeePerGas: 15n * GWEI,
      });

      const feeData = await service.getEip1559FeeData(42161);

      expect(feeData.maxFeePerGas).toBe(30n * GWEI);
      expect(feeData.maxPriorityFeePerGas).toBe(2n * GWEI);
      expect(feeData.baseFee).toBe(15n * GWEI);
      expect(Number(feeData.maxFeePerGasGwei)).toBeCloseTo(30, 0);
      expect(Number(feeData.maxPriorityFeePerGasGwei)).toBeCloseTo(2, 0);
      expect(Number(feeData.baseFeeGwei)).toBeCloseTo(15, 0);
    });

    it('should handle null fee data gracefully', async () => {
      mockProvider.getFeeData.mockResolvedValue({
        maxFeePerGas: null,
        maxPriorityFeePerGas: null,
        gasPrice: 10n,
      });
      mockProvider.getBlock.mockResolvedValue({
        baseFeePerGas: null,
      });

      const feeData = await service.getEip1559FeeData(42161);

      expect(feeData.maxFeePerGas).toBe(0n);
      expect(feeData.maxPriorityFeePerGas).toBe(0n);
      expect(feeData.baseFee).toBe(0n);
    });

    it('should handle null block gracefully', async () => {
      const GWEI = 1_000_000_000n;
      mockProvider.getFeeData.mockResolvedValue({
        maxFeePerGas: 30n * GWEI,
        maxPriorityFeePerGas: 2n * GWEI,
        gasPrice: 20n * GWEI,
      });
      mockProvider.getBlock.mockResolvedValue(null);

      const feeData = await service.getEip1559FeeData(42161);
      expect(feeData.baseFee).toBe(0n);
    });
  });

  describe('estimateGas', () => {
    const GWEI = 1_000_000_000n;

    beforeEach(() => {
      mockProvider.getFeeData.mockResolvedValue({
        maxFeePerGas: 20n * GWEI,
        maxPriorityFeePerGas: 1n * GWEI,
        gasPrice: 15n * GWEI,
      });
      mockProvider.getBlock.mockResolvedValue({
        baseFeePerGas: 10n * GWEI,
      });
      mockProvider.estimateGas.mockResolvedValue(200000n);
    });

    it('should estimate gas with safety buffer', async () => {
      const txRequest = {
        to: '0x1234567890123456789012345678901234567890',
        data: '0x',
        from: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
      };

      const result = await service.estimateGas(42161, txRequest);

      // 200000 * 1.15 = 230000
      expect(result.gasLimit).toBe(230000n);
      expect(result.withinPolicy).toBe(true);
      expect(result.policyWarning).toBeUndefined();
      expect(result.estimatedCostWei).toBeGreaterThan(0n);
    });

    it('should detect policy violation when gas price exceeds max', async () => {
      process.env.MAX_GAS_PRICE_GWEI = '10'; // Lower than the 20 GWEI from mock

      const result = await service.estimateGas(42161, { to: '0x1234', data: '0x' });

      expect(result.withinPolicy).toBe(false);
      expect(result.policyWarning).toContain('exceeds policy max');
    });

    it('should detect priority fee violation', async () => {
      process.env.MAX_PRIORITY_FEE_GWEI = '0.5'; // Lower than the 1 GWEI from mock

      const result = await service.estimateGas(42161, { to: '0x1234', data: '0x' });

      expect(result.withinPolicy).toBe(true); // maxFee is fine
      expect(result.policyWarning).toContain('Priority fee');
    });

    it('should throw on provider error', async () => {
      mockProvider.estimateGas.mockRejectedValue(new Error('RPC error: contract revert'));

      await expect(
        service.estimateGas(42161, { to: '0x1234', data: '0x' }),
      ).rejects.toThrow('RPC error: contract revert');
    });
  });

  describe('shouldReject', () => {
    it('should reject when maxFeePerGas exceeds policy', () => {
      process.env.MAX_GAS_PRICE_GWEI = '10';
      const feeData: Eip1559FeeData = {
        maxFeePerGas: 20n * 1_000_000_000n,
        maxPriorityFeePerGas: 1n * 1_000_000_000n,
        baseFee: 10n * 1_000_000_000n,
        maxFeePerGasGwei: '20.0',
        maxPriorityFeePerGasGwei: '1.0',
        baseFeeGwei: '10.0',
      };

      expect(service.shouldReject(42161, feeData)).toBe(true);
    });

    it('should reject when priorityFee exceeds policy', () => {
      process.env.MAX_PRIORITY_FEE_GWEI = '0.5';
      const feeData: Eip1559FeeData = {
        maxFeePerGas: 10n * 1_000_000_000n,
        maxPriorityFeePerGas: 2n * 1_000_000_000n,
        baseFee: 5n * 1_000_000_000n,
        maxFeePerGasGwei: '10.0',
        maxPriorityFeePerGasGwei: '2.0',
        baseFeeGwei: '5.0',
      };

      expect(service.shouldReject(42161, feeData)).toBe(true);
    });

    it('should not reject when within policy', () => {
      const feeData: Eip1559FeeData = {
        maxFeePerGas: 20n * 1_000_000_000n,
        maxPriorityFeePerGas: 1n * 1_000_000_000n,
        baseFee: 10n * 1_000_000_000n,
        maxFeePerGasGwei: '20.0',
        maxPriorityFeePerGasGwei: '1.0',
        baseFeeGwei: '10.0',
      };

      expect(service.shouldReject(42161, feeData)).toBe(false);
    });

    it('should not reject when rejectOnExceed is false', () => {
      process.env.GAS_REJECT_ON_EXCEED = 'false';
      process.env.MAX_GAS_PRICE_GWEI = '1'; // Very low

      const feeData: Eip1559FeeData = {
        maxFeePerGas: 100n * 1_000_000_000n,
        maxPriorityFeePerGas: 50n * 1_000_000_000n,
        baseFee: 10n * 1_000_000_000n,
        maxFeePerGasGwei: '100.0',
        maxPriorityFeePerGasGwei: '50.0',
        baseFeeGwei: '10.0',
      };

      expect(service.shouldReject(42161, feeData)).toBe(false);
    });
  });

  describe('getCappedFeeData', () => {
    const GWEI = 1_000_000_000n;

    beforeEach(() => {
      mockProvider.getFeeData.mockResolvedValue({
        maxFeePerGas: 100n * GWEI,
        maxPriorityFeePerGas: 10n * GWEI,
        gasPrice: 50n * GWEI,
      });
      mockProvider.getBlock.mockResolvedValue({
        baseFeePerGas: 30n * GWEI,
      });
    });

    it('should clamp maxFeePerGas to policy limit', async () => {
      process.env.MAX_GAS_PRICE_GWEI = '50';
      process.env.MAX_PRIORITY_FEE_GWEI = '5';

      const capped = await service.getCappedFeeData(42161);

      // 50 GWEI max = 50 * 1e9 wei
      expect(capped.maxFeePerGas).toBe(50n * GWEI);
      expect(capped.maxPriorityFeePerGas).toBe(5n * GWEI);
    });

    it('should not clamp when within policy', async () => {
      process.env.MAX_GAS_PRICE_GWEI = '200';
      process.env.MAX_PRIORITY_FEE_GWEI = '20';

      const capped = await service.getCappedFeeData(42161);

      expect(capped.maxFeePerGas).toBe(100n * GWEI);
      expect(capped.maxPriorityFeePerGas).toBe(10n * GWEI);
    });

    it('should preserve baseFee uncapped', async () => {
      process.env.MAX_GAS_PRICE_GWEI = '10';

      const capped = await service.getCappedFeeData(42161);

      expect(capped.baseFee).toBe(30n * GWEI);
    });
  });
});