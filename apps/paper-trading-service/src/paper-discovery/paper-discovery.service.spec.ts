import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { AuditClientService } from '@arbibot/nest-platform';

import { PaperDiscoveryService } from './paper-discovery.service';
import {
  PaperDiscoveryCandidateEntity,
  PaperTradeEntity,
} from '@arbibot/persistence';

// Mock AuditClientService
class MockAuditClientService {
  appendEntry(): Promise<void> {
    return Promise.resolve();
  }
}

async function createDiscoveryService(): Promise<PaperDiscoveryService> {
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      PaperDiscoveryService,
      {
        provide: getRepositoryToken(PaperDiscoveryCandidateEntity),
        useClass: Repository,
      },
      {
        provide: getRepositoryToken(PaperTradeEntity),
        useClass: Repository,
      },
      {
        provide: AuditClientService,
        useClass: MockAuditClientService,
      },
    ],
  }).compile();
  return module.get<PaperDiscoveryService>(PaperDiscoveryService);
}

describe('PaperDiscoveryService', () => {
  let service: PaperDiscoveryService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaperDiscoveryService,
        {
          provide: getRepositoryToken(PaperDiscoveryCandidateEntity),
          useClass: Repository,
        },
        {
          provide: getRepositoryToken(PaperTradeEntity),
          useClass: Repository,
        },
        {
          provide: AuditClientService,
          useClass: MockAuditClientService,
        },
      ],
    }).compile();

    service = module.get<PaperDiscoveryService>(PaperDiscoveryService);
  });

  describe('getConfig', () => {
    it('should return default configuration', () => {
      const config = service.getConfig();

      expect(config).toBeDefined();
      expect(config.enabled).toBe(true);
      expect(config.intervalMs).toBeGreaterThanOrEqual(5000); // Minimum 5s
      expect(config.minProfitUsd).toBeGreaterThanOrEqual(0);
      expect(config.minLiquidityScore).toBeGreaterThanOrEqual(0);
      expect(config.minLiquidityScore).toBeLessThanOrEqual(1);
      expect(config.maxCandidatesPerRun).toBeGreaterThanOrEqual(1);
    });

    it('should load configuration from environment variables', async () => {
      process.env.PAPER_DISCOVERY_ENABLED = 'false';
      process.env.PAPER_DISCOVERY_INTERVAL_MS = '60000';
      process.env.PAPER_DISCOVERY_MIN_PROFIT_USD = '20';
      process.env.PAPER_DISCOVERY_MIN_LIQUIDITY_SCORE = '0.8';
      process.env.PAPER_DISCOVERY_MAX_CANDIDATES_PER_RUN = '100';

      const svc = await createDiscoveryService();
      const config = svc.getConfig();

      expect(config.enabled).toBe(false);
      expect(config.intervalMs).toBe(60000);
      expect(config.minProfitUsd).toBe(20);
      expect(config.minLiquidityScore).toBe(0.8);
      expect(config.maxCandidatesPerRun).toBe(100);
    });
  });

  describe('isEnabled', () => {
    it('should return true when discovery is enabled', async () => {
      process.env.PAPER_DISCOVERY_ENABLED = 'true';
      const svc = await createDiscoveryService();
      expect(svc.isEnabled()).toBe(true);
    });

    it('should return false when discovery is disabled', async () => {
      process.env.PAPER_DISCOVERY_ENABLED = 'false';
      const svc = await createDiscoveryService();
      expect(svc.isEnabled()).toBe(false);
    });
  });

  describe('getFallbackPaperOnlyFilters', () => {
    it('should return empty array when no filters are configured', () => {
      process.env.PAPER_DISCOVERY_PAPER_ONLY_TOKENS = '';
      process.env.PAPER_DISCOVERY_PAPER_ONLY_ROUTES = '';

      const filters = service['getFallbackPaperOnlyFilters']();

      expect(filters).toEqual([]);
    });

    it('should parse token and route filters from environment variables', () => {
      process.env.PAPER_DISCOVERY_PAPER_ONLY_TOKENS = 'BTC,ETH';
      process.env.PAPER_DISCOVERY_PAPER_ONLY_ROUTES = 'btc-eth-uniswap,eth-usdc-curve';

      const filters = service['getFallbackPaperOnlyFilters']();

      expect(filters).toHaveLength(4); // 2 tokens * 2 routes = 4 combinations
      expect(filters[0]).toEqual({
        tokenKey: 'BTC',
        routeKey: 'btc-eth-uniswap',
        isPaperOnly: true,
      });
      expect(filters[1]).toEqual({
        tokenKey: 'BTC',
        routeKey: 'eth-usdc-curve',
        isPaperOnly: true,
      });
      expect(filters[2]).toEqual({
        tokenKey: 'ETH',
        routeKey: 'btc-eth-uniswap',
        isPaperOnly: true,
      });
      expect(filters[3]).toEqual({
        tokenKey: 'ETH',
        routeKey: 'eth-usdc-curve',
        isPaperOnly: true,
      });
    });
  });

  describe('profileSnapshot', () => {
    it('should return null for non-paper-only token/route combination', () => {
      const paperOnlyFilters = [
        { tokenKey: 'BTC', routeKey: 'btc-eth-uniswap', isPaperOnly: true },
      ];

      const snapshot = {
        id: 'test-snapshot-1',
        instrumentKey: 'ETH',
        routeKey: 'eth-usdc-curve',
        bidPrice: '100.0',
        askPrice: '101.0',
        timestamp: new Date(),
        isStale: false,
      };

      const result = service['profileSnapshot'](snapshot, paperOnlyFilters);

      expect(result).toBeNull();
    });

    it('should return null for invalid prices', () => {
      const paperOnlyFilters = [
        { tokenKey: 'BTC', routeKey: 'btc-eth-uniswap', isPaperOnly: true },
      ];

      const snapshot = {
        id: 'test-snapshot-1',
        instrumentKey: 'BTC',
        routeKey: 'btc-eth-uniswap',
        bidPrice: 'invalid',
        askPrice: '101.0',
        timestamp: new Date(),
        isStale: false,
      };

      const result = service['profileSnapshot'](snapshot, paperOnlyFilters);

      expect(result).toBeNull();
    });

    it('should return candidate with theoretical profit and liquidity score', () => {
      const paperOnlyFilters = [
        { tokenKey: 'BTC', routeKey: 'btc-eth-uniswap', isPaperOnly: true },
      ];

      const snapshot = {
        id: 'test-snapshot-1',
        instrumentKey: 'BTC',
        routeKey: 'btc-eth-uniswap',
        bidPrice: '100.0',
        askPrice: '101.0',
        timestamp: new Date(),
        isStale: false,
      };

      const result = service['profileSnapshot'](snapshot, paperOnlyFilters);

      expect(result).not.toBeNull();
      expect(result?.tokenKey).toBe('BTC');
      expect(result?.routeKey).toBe('btc-eth-uniswap');
      expect(result?.bidPrice).toBe('100.0');
      expect(result?.askPrice).toBe('101.0');
      expect(parseFloat(result?.theoreticalProfitUsd || '0')).toBe(1.0); // 101 - 100 = 1
      expect(parseFloat(result?.liquidityScore || '0')).toBeGreaterThan(0);
      expect(parseFloat(result?.liquidityScore || '0')).toBeLessThanOrEqual(1);
    });

    it('should mark candidate as eligible when meeting thresholds', async () => {
      process.env.PAPER_DISCOVERY_MIN_PROFIT_USD = '0.5';
      process.env.PAPER_DISCOVERY_MIN_LIQUIDITY_SCORE = '0.1';

      const svc = await createDiscoveryService();
      const paperOnlyFilters = [
        { tokenKey: 'BTC', routeKey: 'btc-eth-uniswap', isPaperOnly: true },
      ];

      const snapshot = {
        id: 'test-snapshot-1',
        instrumentKey: 'BTC',
        routeKey: 'btc-eth-uniswap',
        bidPrice: '100.0',
        askPrice: '101.0',
        timestamp: new Date(),
        isStale: false,
      };

      const result = svc['profileSnapshot'](snapshot, paperOnlyFilters);

      expect(result?.isEligible).toBe(true);
    });

    it('should mark candidate as ineligible when below profit threshold', async () => {
      process.env.PAPER_DISCOVERY_MIN_PROFIT_USD = '10';

      const svc = await createDiscoveryService();
      const paperOnlyFilters = [
        { tokenKey: 'BTC', routeKey: 'btc-eth-uniswap', isPaperOnly: true },
      ];

      const snapshot = {
        id: 'test-snapshot-1',
        instrumentKey: 'BTC',
        routeKey: 'btc-eth-uniswap',
        bidPrice: '100.0',
        askPrice: '101.0',
        timestamp: new Date(),
        isStale: false,
      };

      const result = svc['profileSnapshot'](snapshot, paperOnlyFilters);

      expect(result?.isEligible).toBe(false);
    });

    it('should mark candidate as ineligible when below liquidity threshold', async () => {
      process.env.PAPER_DISCOVERY_MIN_LIQUIDITY_SCORE = '0.9';
      process.env.PAPER_DISCOVERY_MIN_PROFIT_USD = '0.5';

      const svc = await createDiscoveryService();
      const paperOnlyFilters = [
        { tokenKey: 'BTC', routeKey: 'btc-eth-uniswap', isPaperOnly: true },
      ];

      const snapshot = {
        id: 'test-snapshot-1',
        instrumentKey: 'BTC',
        routeKey: 'btc-eth-uniswap',
        bidPrice: '100.0',
        askPrice: '110.0', // Large spread = low liquidity
        timestamp: new Date(),
        isStale: false,
      };

      const result = svc['profileSnapshot'](snapshot, paperOnlyFilters);

      expect(result?.isEligible).toBe(false);
    });
  });

  describe('effective config (paper.discovery)', () => {
    const origFetch = globalThis.fetch;

    async function createServiceForEnv(): Promise<PaperDiscoveryService> {
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          PaperDiscoveryService,
          {
            provide: getRepositoryToken(PaperDiscoveryCandidateEntity),
            useClass: Repository,
          },
          {
            provide: getRepositoryToken(PaperTradeEntity),
            useClass: Repository,
          },
          {
            provide: AuditClientService,
            useClass: MockAuditClientService,
          },
        ],
      }).compile();
      return module.get<PaperDiscoveryService>(PaperDiscoveryService);
    }

    afterEach(() => {
      globalThis.fetch = origFetch;
      delete process.env.CONFIG_SERVICE_URL;
      delete process.env.CONFIG_API_BASE;
      delete process.env.PAPER_DISCOVERY_CONFIG_CACHE_MS;
      process.env.PAPER_DISCOVERY_PAPER_ONLY_TOKENS = '';
      process.env.PAPER_DISCOVERY_PAPER_ONLY_ROUTES = '';
      process.env.PAPER_DISCOVERY_MIN_PROFIT_USD = '10';
    });

    it('merges paperOnly filters from effective JSON when fetch succeeds', async () => {
      process.env.CONFIG_SERVICE_URL = 'http://cfg.test';
      process.env.PAPER_DISCOVERY_CONFIG_CACHE_MS = '60000';
      process.env.PAPER_DISCOVERY_PAPER_ONLY_TOKENS = '';
      process.env.PAPER_DISCOVERY_PAPER_ONLY_ROUTES = '';

      globalThis.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            configValue: JSON.stringify({
              paperOnlyTokens: ['BTC'],
              paperOnlyRoutes: ['r1'],
              minProfitUsd: 5,
            }),
          }),
      });

      const svc = await createServiceForEnv();
      const filters = await svc.fetchPaperOnlyFilters();

      expect(filters).toHaveLength(1);
      expect(filters[0]).toEqual({
        tokenKey: 'BTC',
        routeKey: 'r1',
        isPaperOnly: true,
      });
      expect(svc.getConfig().minProfitUsd).toBe(5);
    });

    it('falls back to env token/route lists when effective fetch fails', async () => {
      process.env.CONFIG_API_BASE = 'http://cfg.test';
      process.env.PAPER_DISCOVERY_PAPER_ONLY_TOKENS = 'ETH';
      process.env.PAPER_DISCOVERY_PAPER_ONLY_ROUTES = 'r2';

      globalThis.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 500,
      });

      const svc = await createServiceForEnv();
      const filters = await svc.fetchPaperOnlyFilters();

      expect(filters).toHaveLength(1);
      expect(filters[0]).toEqual({
        tokenKey: 'ETH',
        routeKey: 'r2',
        isPaperOnly: true,
      });
    });
  });
});
