import { getArbibotMetricsRegistry } from '@arbibot/nest-platform';
import type { ExecutionLegEntity, ExecutionPlanEntity } from '@arbibot/persistence';

import { VenueSubmitClientError } from '../venue/venue-adapter';
import { MockVenueAdapter } from '../venue/mock-venue.adapter';

import { VenueFactoryService, extractVenueKey } from './venue-factory.service';

// ───────────────────────────────────────────────────────────────────────
// Stubs
// ───────────────────────────────────────────────────────────────────────

function planStub(playbookConfig?: Record<string, unknown>): ExecutionPlanEntity {
  return {
    id: 'plan-1',
    correlationId: null,
    state: 'armed',
    capitalReservationId: null,
    riskDecisionId: null,
    routeKey: null,
    entityVersion: 1,
    playbookConfig: playbookConfig ?? null,
    createdAt: new Date(),
    updatedAt: new Date(),
    legs: [],
  } as ExecutionPlanEntity;
}

function legStub(legIndex: number): ExecutionLegEntity {
  return {
    id: 'leg-1',
    planId: 'plan-1',
    legIndex,
    state: 'created',
    entityVersion: 1,
    venueRef: null,
    targetQuantity: 1,
    filledQuantity: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as ExecutionLegEntity;
}

/** Create a mock adapter that tracks calls. */
function mockAdapter(name: string) {
  return {
    constructor: { name },
    submitLeg: jest.fn().mockResolvedValue({ externalOrderId: `${name}-order-1` }),
  } as unknown as MockVenueAdapter;
}

// ───────────────────────────────────────────────────────────────────────
// Tests
// ───────────────────────────────────────────────────────────────────────

describe('VenueFactoryService', () => {
  let service: VenueFactoryService;
  let mockMock: ReturnType<typeof mockAdapter>;
  let mockUniV2: ReturnType<typeof mockAdapter>;
  let mockUniV3: ReturnType<typeof mockAdapter>;
  let mockSushi: ReturnType<typeof mockAdapter>;
  let mockPancake: ReturnType<typeof mockAdapter>;
  let mockBiswap: ReturnType<typeof mockAdapter>;
  let mockPaperDex: ReturnType<typeof mockAdapter>;

  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
    // Clear env flags
    delete process.env.DEX_VENUE_ENABLED;
    delete process.env.VENUE_HTTP_BASE_URL;

    getArbibotMetricsRegistry().clear();

    mockMock = mockAdapter('MockVenueAdapter');
    mockUniV2 = mockAdapter('UniswapV2Adapter');
    mockUniV3 = mockAdapter('UniswapV3Adapter');
    mockSushi = mockAdapter('SushiSwapV2Adapter');
    mockPancake = mockAdapter('PancakeSwapV2Adapter');
    mockBiswap = mockAdapter('BiswapV2Adapter');
    mockPaperDex = mockAdapter('PaperDexAdapter');

    service = new VenueFactoryService(
      mockMock,
      mockUniV2 as any, // eslint-disable-line @typescript-eslint/no-explicit-any
      mockUniV3 as any, // eslint-disable-line @typescript-eslint/no-explicit-any
      mockSushi as any, // eslint-disable-line @typescript-eslint/no-explicit-any
      mockPancake as any, // eslint-disable-line @typescript-eslint/no-explicit-any
      mockBiswap as any, // eslint-disable-line @typescript-eslint/no-explicit-any
      mockPaperDex as any, // eslint-disable-line @typescript-eslint/no-explicit-any
    );
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  // ─────────────────────────────────────────────────────────────────────
  // extractVenueKey
  // ─────────────────────────────────────────────────────────────────────

  describe('extractVenueKey', () => {
    it('returns undefined when playbookConfig is null', () => {
      expect(extractVenueKey(planStub(null as any), legStub(0))).toBeUndefined(); // eslint-disable-line @typescript-eslint/no-explicit-any
    });

    it('returns undefined when no venueKey in config', () => {
      expect(extractVenueKey(planStub({ foo: 'bar' }), legStub(0))).toBeUndefined();
    });

    it('returns plan-level venueKey', () => {
      expect(
        extractVenueKey(planStub({ venueKey: 'uniswap-v2' }), legStub(0)),
      ).toBe('uniswap-v2');
    });

    it('returns leg-level venueKey (overrides plan-level)', () => {
      const config = {
        venueKey: 'uniswap-v2',
        dexSwaps: [{ venueKey: 'uniswap-v3' }],
      };
      expect(extractVenueKey(planStub(config), legStub(0))).toBe('uniswap-v3');
    });

    it('returns plan-level venueKey when leg-level is missing', () => {
      const config = {
        venueKey: 'uniswap-v2',
        dexSwaps: [{ chainId: 42161 }],
      };
      expect(extractVenueKey(planStub(config), legStub(0))).toBe('uniswap-v2');
    });

    it('ignores empty string venueKey', () => {
      expect(extractVenueKey(planStub({ venueKey: '' }), legStub(0))).toBeUndefined();
    });

    it('ignores non-string venueKey', () => {
      expect(extractVenueKey(planStub({ venueKey: 123 } as any), legStub(0))).toBeUndefined(); // eslint-disable-line @typescript-eslint/no-explicit-any
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // resolveAdapter — legacy fallback
  // ─────────────────────────────────────────────────────────────────────

  describe('resolveAdapter — legacy fallback', () => {
    it('returns MockVenueAdapter when no venueKey and no VENUE_HTTP_BASE_URL', () => {
      const adapter = service.resolveAdapter(undefined);
      expect(adapter).toBe(mockMock);
    });

    it('returns HttpVenueAdapter when no venueKey but VENUE_HTTP_BASE_URL is set', () => {
      process.env.VENUE_HTTP_BASE_URL = 'http://venue:8080';
      const adapter = service.resolveAdapter(undefined);
      expect(adapter.constructor.name).toBe('HttpVenueAdapter');
    });

    it('returns MockVenueAdapter when venueKey is "mock"', () => {
      const adapter = service.resolveAdapter('mock');
      expect(adapter).toBe(mockMock);
    });

    it('returns HttpVenueAdapter when venueKey is "http"', () => {
      process.env.VENUE_HTTP_BASE_URL = 'http://venue:8080';
      const adapter = service.resolveAdapter('http');
      expect(adapter.constructor.name).toBe('HttpVenueAdapter');
    });

    it('throws VenueSubmitClientError when venueKey="http" but VENUE_HTTP_BASE_URL is unset', () => {
      expect(() => service.resolveAdapter('http')).toThrow(VenueSubmitClientError);
      expect(() => service.resolveAdapter('http')).toThrow('VENUE_HTTP_BASE_URL is not set');
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // resolveAdapter — DEX routing
  // ─────────────────────────────────────────────────────────────────────

  describe('resolveAdapter — DEX routing', () => {
    it('returns UniswapV2Adapter when venueKey="uniswap-v2" and DEX_VENUE_ENABLED=true', () => {
      process.env.DEX_VENUE_ENABLED = 'true';
      const adapter = service.resolveAdapter('uniswap-v2');
      expect(adapter).toBe(mockUniV2);
    });

    it('returns UniswapV3Adapter when venueKey="uniswap-v3" and DEX_VENUE_ENABLED=true', () => {
      process.env.DEX_VENUE_ENABLED = 'true';
      const adapter = service.resolveAdapter('uniswap-v3');
      expect(adapter).toBe(mockUniV3);
    });

    it('throws VenueSubmitClientError when DEX_VENUE_ENABLED is not "true"', () => {
      process.env.DEX_VENUE_ENABLED = 'false';
      expect(() => service.resolveAdapter('uniswap-v2')).toThrow(VenueSubmitClientError);
      expect(() => service.resolveAdapter('uniswap-v2')).toThrow('DEX_VENUE_ENABLED');
    });

    it('throws VenueSubmitClientError when DEX_VENUE_ENABLED is unset', () => {
      delete process.env.DEX_VENUE_ENABLED;
      expect(() => service.resolveAdapter('uniswap-v3')).toThrow(VenueSubmitClientError);
      expect(() => service.resolveAdapter('uniswap-v3')).toThrow('DEX_VENUE_ENABLED');
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // resolveAdapter — paper-dex routing
  // ─────────────────────────────────────────────────────────────────────

  describe('resolveAdapter — paper-dex routing', () => {
    it('returns PaperDexAdapter when venueKey="paper-dex" (no DEX_VENUE_ENABLED required)', () => {
      delete process.env.DEX_VENUE_ENABLED;
      const adapter = service.resolveAdapter('paper-dex');
      expect(adapter).toBe(mockPaperDex);
    });

    it('returns PaperDexAdapter even when DEX_VENUE_ENABLED=false', () => {
      process.env.DEX_VENUE_ENABLED = 'false';
      const adapter = service.resolveAdapter('paper-dex');
      expect(adapter).toBe(mockPaperDex);
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // resolveAdapter — unknown key
  // ─────────────────────────────────────────────────────────────────────

  describe('resolveAdapter — unknown key', () => {
    it('throws VenueSubmitClientError for unknown venueKey', () => {
      expect(() => service.resolveAdapter('pancakeswap')).toThrow(VenueSubmitClientError);
      expect(() => service.resolveAdapter('pancakeswap')).toThrow('unknown venueKey "pancakeswap"');
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // submitLeg — integration
  // ─────────────────────────────────────────────────────────────────────

  describe('submitLeg', () => {
    it('delegates to MockVenueAdapter for legacy plan', async () => {
      const plan = planStub(null as any); // eslint-disable-line @typescript-eslint/no-explicit-any
      const leg = legStub(0);

      const result = await service.submitLeg(plan, leg);

      expect(result).toEqual({ externalOrderId: 'MockVenueAdapter-order-1' });
      expect(mockMock.submitLeg).toHaveBeenCalledWith(plan, leg);
    });

    it('delegates to UniswapV2Adapter for venueKey="uniswap-v2"', async () => {
      process.env.DEX_VENUE_ENABLED = 'true';
      const plan = planStub({ venueKey: 'uniswap-v2' });
      const leg = legStub(0);

      const result = await service.submitLeg(plan, leg);

      expect(result).toEqual({ externalOrderId: 'UniswapV2Adapter-order-1' });
      expect(mockUniV2.submitLeg).toHaveBeenCalledWith(plan, leg);
    });

    it('delegates to UniswapV3Adapter for leg-level venueKey="uniswap-v3"', async () => {
      process.env.DEX_VENUE_ENABLED = 'true';
      const plan = planStub({
        venueKey: 'uniswap-v2',
        dexSwaps: [{ venueKey: 'uniswap-v3' }],
      });
      const leg = legStub(0);

      const result = await service.submitLeg(plan, leg);

      expect(result).toEqual({ externalOrderId: 'UniswapV3Adapter-order-1' });
      expect(mockUniV3.submitLeg).toHaveBeenCalledWith(plan, leg);
    });

    it('throws VenueSubmitClientError when DEX key but DEX_VENUE_ENABLED=false', async () => {
      process.env.DEX_VENUE_ENABLED = 'false';
      const plan = planStub({ venueKey: 'uniswap-v2' });
      const leg = legStub(0);

      await expect(service.submitLeg(plan, leg)).rejects.toThrow(VenueSubmitClientError);
    });

    it('delegates to SushiSwapV2Adapter for venueKey="sushiswap"', async () => {
      process.env.DEX_VENUE_ENABLED = 'true';
      const plan = planStub({ venueKey: 'sushiswap' });
      const leg = legStub(0);

      const result = await service.submitLeg(plan, leg);

      expect(result).toEqual({ externalOrderId: 'SushiSwapV2Adapter-order-1' });
      expect(mockSushi.submitLeg).toHaveBeenCalledWith(plan, leg);
    });

    it('delegates to PaperDexAdapter for venueKey="paper-dex"', async () => {
      const plan = planStub({ venueKey: 'paper-dex' });
      const leg = legStub(0);

      const result = await service.submitLeg(plan, leg);

      expect(result).toEqual({ externalOrderId: 'PaperDexAdapter-order-1' });
      expect(mockPaperDex.submitLeg).toHaveBeenCalledWith(plan, leg);
    });
  });
});