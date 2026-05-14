import { Test } from '@nestjs/testing';
import { getArbibotMetricsRegistry } from '@arbibot/nest-platform';

import { DexHealthService } from './dex-health.service';
import { RpcProviderManager } from './rpc/rpc-provider-manager.service';
import { WalletManagerService } from './wallet-manager.service';
import { KeyVaultService } from '@arbibot/nest-platform';

describe('DexHealthService', () => {
  let service: DexHealthService;
  let rpcProviderManager: RpcProviderManager;
  let keyVaultService: KeyVaultService;

  beforeEach(async () => {
    // Clear metrics registry to avoid re-registration
    getArbibotMetricsRegistry().clear();

    const module = await Test.createTestingModule({
      providers: [
        DexHealthService,
        {
          provide: RpcProviderManager,
          useValue: {
            getAllHealthStatus: jest.fn(),
            getProvider: jest.fn(),
          },
        },
        {
          provide: WalletManagerService,
          useValue: {},
        },
        {
          provide: KeyVaultService,
          useValue: {
            getMetrics: jest.fn(),
            getAllWalletKeys: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get(DexHealthService);
    rpcProviderManager = module.get(RpcProviderManager);
    keyVaultService = module.get(KeyVaultService);
  });

  afterEach(() => {
    getArbibotMetricsRegistry().clear();
  });

  describe('getDexHealth', () => {
    it('should return healthy when all components are healthy', () => {
      const rpcStatus = new Map<number, { healthy: boolean; latency: number; error?: string }>();
      rpcStatus.set(42161, { healthy: true, latency: 30 });
      (rpcProviderManager.getAllHealthStatus as jest.Mock).mockReturnValue(rpcStatus);

      (keyVaultService.getMetrics as jest.Mock).mockReturnValue({
        encryptCount: 10,
        decryptCount: 20,
        averageEncryptLatency: 5,
        averageDecryptLatency: 4,
      });
      (keyVaultService.getAllWalletKeys as jest.Mock).mockReturnValue([
        { keyId: 'k1', address: '0xabc', chainId: 42161, isActive: true, createdAt: new Date() },
      ]);

      const result = service.getDexHealth();

      expect(result.status).toBe('healthy');
      expect(result.rpc['chain_42161']!.status).toBe('healthy');
      expect(result.rpc['chain_42161']!.latencyMs).toBe(30);
      expect(result.vault.status).toBe('healthy');
      expect(result.wallet.status).toBe('healthy');
      expect(result.mempoolMonitor.status).toBe('not_configured');
      expect(result.timestamp).toBeDefined();
    });

    it('should return degraded when RPC latency is high', () => {
      const rpcStatus = new Map<number, { healthy: boolean; latency: number; error?: string }>();
      rpcStatus.set(42161, { healthy: true, latency: 90 });
      (rpcProviderManager.getAllHealthStatus as jest.Mock).mockReturnValue(rpcStatus);

      (keyVaultService.getMetrics as jest.Mock).mockReturnValue({
        encryptCount: 5,
        decryptCount: 5,
        averageEncryptLatency: 3,
        averageDecryptLatency: 3,
      });
      (keyVaultService.getAllWalletKeys as jest.Mock).mockReturnValue([
        { keyId: 'k1', address: '0xabc', chainId: 42161, isActive: true, createdAt: new Date() },
      ]);

      const result = service.getDexHealth();

      expect(result.status).toBe('degraded');
      expect(result.rpc['chain_42161']!.status).toBe('degraded');
      expect(result.rpc['chain_42161']!.latencyMs).toBe(90);
    });

    it('should return unhealthy when RPC is unhealthy', () => {
      const rpcStatus = new Map<number, { healthy: boolean; latency: number; error?: string }>();
      rpcStatus.set(42161, { healthy: false, latency: 500, error: 'Connection refused' });
      (rpcProviderManager.getAllHealthStatus as jest.Mock).mockReturnValue(rpcStatus);

      (keyVaultService.getMetrics as jest.Mock).mockReturnValue({
        encryptCount: 1,
        decryptCount: 1,
        averageEncryptLatency: 1,
        averageDecryptLatency: 1,
      });
      (keyVaultService.getAllWalletKeys as jest.Mock).mockReturnValue([
        { keyId: 'k1', address: '0xabc', chainId: 42161, isActive: true, createdAt: new Date() },
      ]);

      const result = service.getDexHealth();

      expect(result.status).toBe('unhealthy');
      expect(result.rpc['chain_42161']!.status).toBe('unhealthy');
      expect(result.rpc['chain_42161']!.error).toBe('Connection refused');
    });

    it('should return not_configured when no RPC providers', () => {
      (rpcProviderManager.getAllHealthStatus as jest.Mock).mockReturnValue(new Map());

      (keyVaultService.getMetrics as jest.Mock).mockReturnValue({
        encryptCount: 0,
        decryptCount: 0,
        averageEncryptLatency: 0,
        averageDecryptLatency: 0,
      });
      (keyVaultService.getAllWalletKeys as jest.Mock).mockReturnValue([
        { keyId: 'k1', address: '0xabc', chainId: 42161, isActive: true, createdAt: new Date() },
      ]);

      const result = service.getDexHealth();

      expect(result.rpc['none']!.status).toBe('not_configured');
    });

    it('should return degraded when no active wallets', () => {
      const rpcStatus = new Map<number, { healthy: boolean; latency: number; error?: string }>();
      rpcStatus.set(42161, { healthy: true, latency: 20 });
      (rpcProviderManager.getAllHealthStatus as jest.Mock).mockReturnValue(rpcStatus);

      (keyVaultService.getMetrics as jest.Mock).mockReturnValue({
        encryptCount: 0,
        decryptCount: 0,
        averageEncryptLatency: 0,
        averageDecryptLatency: 0,
      });
      (keyVaultService.getAllWalletKeys as jest.Mock).mockReturnValue([]);

      const result = service.getDexHealth();

      expect(result.wallet.status).toBe('degraded');
      expect(result.wallet.error).toBe('No active wallets registered');
    });

    it('should return unhealthy when vault throws', () => {
      const rpcStatus = new Map<number, { healthy: boolean; latency: number; error?: string }>();
      rpcStatus.set(42161, { healthy: true, latency: 20 });
      (rpcProviderManager.getAllHealthStatus as jest.Mock).mockReturnValue(rpcStatus);

      (keyVaultService.getMetrics as jest.Mock).mockImplementation(() => {
        throw new Error('Vault unavailable');
      });
      (keyVaultService.getAllWalletKeys as jest.Mock).mockReturnValue([
        { keyId: 'k1', address: '0xabc', chainId: 42161, isActive: true, createdAt: new Date() },
      ]);

      const result = service.getDexHealth();

      expect(result.vault.status).toBe('unhealthy');
      expect(result.vault.error).toBe('Vault unavailable');
    });

    it('should handle multiple chains with mixed health', () => {
      const rpcStatus = new Map<number, { healthy: boolean; latency: number; error?: string }>();
      rpcStatus.set(42161, { healthy: true, latency: 25 });
      rpcStatus.set(8453, { healthy: true, latency: 50 });
      rpcStatus.set(56, { healthy: false, latency: 300, error: 'Timeout' });
      (rpcProviderManager.getAllHealthStatus as jest.Mock).mockReturnValue(rpcStatus);

      (keyVaultService.getMetrics as jest.Mock).mockReturnValue({
        encryptCount: 10,
        decryptCount: 10,
        averageEncryptLatency: 5,
        averageDecryptLatency: 5,
      });
      (keyVaultService.getAllWalletKeys as jest.Mock).mockReturnValue([
        { keyId: 'k1', address: '0xabc', chainId: 42161, isActive: true, createdAt: new Date() },
        { keyId: 'k2', address: '0xdef', chainId: 8453, isActive: true, createdAt: new Date() },
      ]);

      const result = service.getDexHealth();

      expect(result.status).toBe('unhealthy');
      expect(result.rpc['chain_42161']!.status).toBe('healthy');
      expect(result.rpc['chain_8453']!.status).toBe('healthy');
      expect(result.rpc['chain_56']!.status).toBe('unhealthy');
      expect(result.wallet.details).toHaveProperty('walletsPerChain');
    });

    it('should show mempool monitor as healthy when enabled', () => {
      const originalEnv = process.env.MEMPOOL_MONITOR_ENABLED;
      process.env.MEMPOOL_MONITOR_ENABLED = 'true';

      const rpcStatus = new Map<number, { healthy: boolean; latency: number; error?: string }>();
      rpcStatus.set(42161, { healthy: true, latency: 20 });
      (rpcProviderManager.getAllHealthStatus as jest.Mock).mockReturnValue(rpcStatus);

      (keyVaultService.getMetrics as jest.Mock).mockReturnValue({
        encryptCount: 0,
        decryptCount: 0,
        averageEncryptLatency: 0,
        averageDecryptLatency: 0,
      });
      (keyVaultService.getAllWalletKeys as jest.Mock).mockReturnValue([
        { keyId: 'k1', address: '0xabc', chainId: 42161, isActive: true, createdAt: new Date() },
      ]);

      const result = service.getDexHealth();

      expect(result.mempoolMonitor.status).toBe('healthy');
      expect(result.mempoolMonitor.details).toEqual({ enabled: true });

      // Restore env
      if (originalEnv === undefined) {
        delete process.env.MEMPOOL_MONITOR_ENABLED;
      } else {
        process.env.MEMPOOL_MONITOR_ENABLED = originalEnv;
      }
    });
  });

  describe('getBridgeHealth', () => {
    it('should return not_configured stub for DEX-2', () => {
      const result = service.getBridgeHealth();

      expect(result.status).toBe('not_configured');
      expect(result.message).toContain('DEX-2');
      expect(result.timestamp).toBeDefined();
    });
  });
});