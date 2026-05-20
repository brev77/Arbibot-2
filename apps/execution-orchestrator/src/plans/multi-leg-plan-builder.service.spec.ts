import { BadRequestException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import { AuditClientService } from '@arbibot/nest-platform';
import { ExecutionPlanEntity } from '@arbibot/persistence';

import { BridgeAdapterFactoryService } from '../execution/bridge/bridge-adapter-factory.service';
import type { BridgeAdapter } from '../execution/bridge/bridge-adapter.interface';

import { MultiLegPlanBuilderService } from './multi-leg-plan-builder.service';
import type { CreateMultiLegPlanDto, LegDescriptorDto } from './dto/create-multi-leg-plan.dto';

// ───────────────────────────────────────────────────────────────────────
// Helpers
// ───────────────────────────────────────────────────────────────────────

function makeLeg(
  overrides: Partial<LegDescriptorDto> & { legType: 'dex' | 'bridge' },
): LegDescriptorDto {
  return {
    chainId: 42161,
    targetQuantity: 10,
    ...overrides,
  };
}

function makeDexLeg(overrides: Partial<LegDescriptorDto> = {}): LegDescriptorDto {
  return makeLeg({ legType: 'dex', chainId: 42161, ...overrides });
}

function makeBridgeLeg(overrides: Partial<LegDescriptorDto> = {}): LegDescriptorDto {
  return makeLeg({
    legType: 'bridge',
    chainId: 42161,
    bridgeKey: 'across',
    destinationChainId: 8453,
    token: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
    destinationToken: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
    amount: '1000000000000000000',
    ...overrides,
  });
}

/**
 * Create a mock adapter for the bridge factory.
 */
function mockAdapter(
  bridgeKey: string,
  supportedChains: ReadonlyArray<readonly [number, number]>,
): BridgeAdapter {
  return {
    bridgeKey,
    supportedChains,
    submitBridgeTransfer: jest.fn(),
    checkBridgeStatus: jest.fn(),
    estimateBridgeFee: jest.fn(),
    estimateRelayTime: jest.fn(),
  };
}

// ───────────────────────────────────────────────────────────────────────
// Mocks
// ───────────────────────────────────────────────────────────────────────

const mockAudit = { record: jest.fn() };

const mockPlanEntity = {
  id: '00000000-0000-0000-0000-000000000001',
  state: 'planned',
  entityVersion: 1,
  correlationId: null,
  riskDecisionId: null,
  routeKey: null,
  capitalReservationId: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  playbookConfig: null,
};

function createMockRepo() {
  const saved: ExecutionPlanEntity[] = [];
  return {
    create: jest.fn((data: Partial<ExecutionPlanEntity>) => ({
      ...mockPlanEntity,
      ...data,
      id: `test-plan-${saved.length}`,
    })),
    save: jest.fn((entity: ExecutionPlanEntity) => {
      saved.push(entity);
      return Promise.resolve(entity);
    }),
    find: jest.fn(),
    findOne: jest.fn(),
  };
}

function createMockBridgeFactory(adapters: Map<string, BridgeAdapter>) {
  return {
    resolveAdapter: jest.fn((key: string) => {
      const adapter = adapters.get(key);
      if (!adapter) throw new Error(`Unknown bridge: ${key}`);
      return adapter;
    }),
    hasAdapter: jest.fn((key: string) => adapters.has(key)),
    getRegisteredBridgeKeys: jest.fn(() => [...adapters.keys()]),
  };
}

// ───────────────────────────────────────────────────────────────────────
// Tests
// ───────────────────────────────────────────────────────────────────────

describe('MultiLegPlanBuilderService', () => {
  let service: MultiLegPlanBuilderService;
  let planRepo: ReturnType<typeof createMockRepo>;
  let bridgeFactory: ReturnType<typeof createMockBridgeFactory>;

  beforeEach(async () => {
    planRepo = createMockRepo();

    const acrossAdapter = mockAdapter('across', [
      [42161, 8453], // Arb → Base
      [8453, 42161], // Base → Arb
      [1, 42161],    // ETH → Arb
    ]);
    const stargateAdapter = mockAdapter('stargate', [
      [42161, 8453],
      [1, 42161],
    ]);
    const nativeAdapter = mockAdapter('native', [
      [1, 42161],    // ETH → Arb via Inbox
      [1, 8453],     // ETH → Base via L1StandardBridge
      [8453, 1],     // Base → ETH via L2StandardBridge
    ]);

    const adapters = new Map([
      ['across', acrossAdapter],
      ['stargate', stargateAdapter],
      ['native', nativeAdapter],
    ]);

    bridgeFactory = createMockBridgeFactory(adapters);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MultiLegPlanBuilderService,
        { provide: DataSource, useValue: {} },
        { provide: getRepositoryToken(ExecutionPlanEntity), useValue: planRepo },
        { provide: AuditClientService, useValue: mockAudit },
        { provide: BridgeAdapterFactoryService, useValue: bridgeFactory },
      ],
    }).compile();

    service = module.get(MultiLegPlanBuilderService);
    mockAudit.record.mockClear();
  });

  // ── Validation: leg count ───────────────────────────────────────────

  describe('leg count validation', () => {
    it('should reject plans with fewer than 2 legs', async () => {
      const dto: CreateMultiLegPlanDto = {
        legs: [makeDexLeg()],
      };
      await expect(service.buildMultiLegPlan(dto)).rejects.toThrow(BadRequestException);
      await expect(service.buildMultiLegPlan(dto)).rejects.toThrow('at least 2 legs');
    });

    it('should reject plans with more than 8 legs', async () => {
      const dto: CreateMultiLegPlanDto = {
        legs: Array.from({ length: 9 }, (_, i) => makeDexLeg({ chainId: 42161 + i })),
      };
      await expect(service.buildMultiLegPlan(dto)).rejects.toThrow(BadRequestException);
      await expect(service.buildMultiLegPlan(dto)).rejects.toThrow('at most 8 legs');
    });
  });

  // ── Validation: start/end must be DEX ───────────────────────────────

  describe('start/end DEX validation', () => {
    it('should reject plans starting with a bridge leg', async () => {
      const dto: CreateMultiLegPlanDto = {
        legs: [
          makeBridgeLeg(),
          makeDexLeg({ chainId: 8453 }),
        ],
      };
      await expect(service.buildMultiLegPlan(dto)).rejects.toThrow('must start with a DEX leg');
    });

    it('should reject plans ending with a bridge leg', async () => {
      const dto: CreateMultiLegPlanDto = {
        legs: [
          makeDexLeg(),
          makeBridgeLeg(),
        ],
      };
      await expect(service.buildMultiLegPlan(dto)).rejects.toThrow('must end with a DEX leg');
    });
  });

  // ── Validation: adjacent bridge legs ────────────────────────────────

  describe('adjacent bridge legs', () => {
    it('should reject adjacent bridge legs', async () => {
      const dto: CreateMultiLegPlanDto = {
        legs: [
          makeDexLeg(),
          makeBridgeLeg(),
          makeBridgeLeg({ chainId: 8453, destinationChainId: 1 }),
          makeDexLeg({ chainId: 1 }),
        ],
      };
      await expect(service.buildMultiLegPlan(dto)).rejects.toThrow('Adjacent bridge legs');
    });

    it('should reject more than 2 bridge legs', async () => {
      const dto: CreateMultiLegPlanDto = {
        legs: [
          makeDexLeg({ chainId: 1 }),
          makeBridgeLeg({ chainId: 1, destinationChainId: 42161 }),
          makeDexLeg({ chainId: 42161 }),
          makeBridgeLeg({ chainId: 42161, destinationChainId: 8453 }),
          makeDexLeg({ chainId: 8453 }),
          makeBridgeLeg({ chainId: 8453, destinationChainId: 1 }),
          makeDexLeg({ chainId: 1 }),
        ],
      };
      await expect(service.buildMultiLegPlan(dto)).rejects.toThrow('at most 2 bridge legs');
    });
  });

  // ── Validation: bridge leg params ──────────────────────────────────

  describe('bridge leg params validation', () => {
    it('should reject bridge leg without bridgeKey', async () => {
      const dto: CreateMultiLegPlanDto = {
        legs: [
          makeDexLeg(),
          makeBridgeLeg({ bridgeKey: undefined } as LegDescriptorDto),
          makeDexLeg({ chainId: 8453 }),
        ],
      };
      await expect(service.buildMultiLegPlan(dto)).rejects.toThrow('must specify bridgeKey');
    });

    it('should reject bridge leg without destinationChainId', async () => {
      const dto: CreateMultiLegPlanDto = {
        legs: [
          makeDexLeg(),
          makeBridgeLeg({ destinationChainId: undefined } as LegDescriptorDto),
          makeDexLeg({ chainId: 8453 }),
        ],
      };
      await expect(service.buildMultiLegPlan(dto)).rejects.toThrow('must specify destinationChainId');
    });

    it('should reject bridge leg without token', async () => {
      const dto: CreateMultiLegPlanDto = {
        legs: [
          makeDexLeg(),
          makeBridgeLeg({ token: undefined } as LegDescriptorDto),
          makeDexLeg({ chainId: 8453 }),
        ],
      };
      await expect(service.buildMultiLegPlan(dto)).rejects.toThrow('must specify token');
    });

    it('should reject bridge leg without destinationToken', async () => {
      const dto: CreateMultiLegPlanDto = {
        legs: [
          makeDexLeg(),
          makeBridgeLeg({ destinationToken: undefined } as LegDescriptorDto),
          makeDexLeg({ chainId: 8453 }),
        ],
      };
      await expect(service.buildMultiLegPlan(dto)).rejects.toThrow('must specify destinationToken');
    });

    it('should reject bridge leg without amount', async () => {
      const dto: CreateMultiLegPlanDto = {
        legs: [
          makeDexLeg(),
          makeBridgeLeg({ amount: undefined } as LegDescriptorDto),
          makeDexLeg({ chainId: 8453 }),
        ],
      };
      await expect(service.buildMultiLegPlan(dto)).rejects.toThrow('must specify amount');
    });

    it('should reject bridge leg with invalid amount', async () => {
      const dto: CreateMultiLegPlanDto = {
        legs: [
          makeDexLeg(),
          makeBridgeLeg({ amount: 'not-a-number' }),
          makeDexLeg({ chainId: 8453 }),
        ],
      };
      await expect(service.buildMultiLegPlan(dto)).rejects.toThrow('valid integer string');
    });
  });

  // ── Validation: unsupported chain pair ─────────────────────────────

  describe('unsupported chain pair', () => {
    it('should reject bridge leg with unsupported chain pair', async () => {
      const dto: CreateMultiLegPlanDto = {
        legs: [
          makeDexLeg({ chainId: 56 }), // BNB
          makeBridgeLeg({ chainId: 56, destinationChainId: 137 }), // BNB → Polygon (not supported)
          makeDexLeg({ chainId: 137 }),
        ],
      };
      await expect(service.buildMultiLegPlan(dto)).rejects.toThrow('does not support');
    });

    it('should reject bridge leg with unknown bridgeKey', async () => {
      const dto: CreateMultiLegPlanDto = {
        legs: [
          makeDexLeg(),
          makeBridgeLeg({ bridgeKey: 'unknown-bridge' }),
          makeDexLeg({ chainId: 8453 }),
        ],
      };
      await expect(service.buildMultiLegPlan(dto)).rejects.toThrow('unknown bridgeKey');
    });
  });

  // ── Happy path: 2-leg DEX plan ─────────────────────────────────────

  describe('happy path: 2-leg DEX plan (same chain)', () => {
    it('should create a plan with 2 DEX legs on the same chain', async () => {
      const dto: CreateMultiLegPlanDto = {
        legs: [
          makeDexLeg({ chainId: 42161, venueKey: 'uniswap-v3' }),
          makeDexLeg({ chainId: 42161, venueKey: 'sushiswap' }),
        ],
      };

      const { plan, config } = await service.buildMultiLegPlan(dto);

      expect(plan.state).toBe('planned');
      expect(config.schemaVersion).toBe(1);
      expect(config.legs).toHaveLength(2);
      expect(config.isCrossChain).toBe(false);
      expect(config.chainIds).toEqual([42161]);
      expect(config.legs[0]!.legType).toBe('dex');
      expect(config.legs[1]!.legType).toBe('dex');
      expect(config.legs[0]!.venueKey).toBe('uniswap-v3');
      expect(config.legs[1]!.venueKey).toBe('sushiswap');
    });
  });

  // ── Happy path: 3-leg cross-chain DEX → Bridge → DEX ──────────────

  describe('happy path: 3-leg cross-chain (Arb → Base)', () => {
    it('should create a cross-chain plan with Across bridge', async () => {
      const dto: CreateMultiLegPlanDto = {
        correlationId: '00000000-0000-0000-0000-000000000099',
        legs: [
          makeDexLeg({ chainId: 42161, venueKey: 'uniswap-v3', targetQuantity: 100 }),
          makeBridgeLeg({
            chainId: 42161,
            bridgeKey: 'across',
            destinationChainId: 8453,
            token: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
            destinationToken: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
            amount: '5000000000000000000',
            recipientAddress: '0x1234567890abcdef1234567890abcdef12345678',
          }),
          makeDexLeg({ chainId: 8453, venueKey: 'uniswap-v3', targetQuantity: 100 }),
        ],
      };

      const { plan, config } = await service.buildMultiLegPlan(dto);

      expect(plan.state).toBe('planned');
      expect(config.isCrossChain).toBe(true);
      expect(config.chainIds).toEqual([42161, 8453]);
      expect(config.legs).toHaveLength(3);

      // Leg 0: DEX on Arb
      expect(config.legs[0]).toEqual({
        legIndex: 0,
        legType: 'dex',
        chainId: 42161,
        targetQuantity: 100,
        venueKey: 'uniswap-v3',
      });

      // Leg 1: Bridge Arb → Base
      expect(config.legs[1]!.legType).toBe('bridge');
      expect(config.legs[1]!.chainId).toBe(42161);
      expect(config.legs[1]!.bridgeKey).toBe('across');
      expect(config.legs[1]!.destinationChainId).toBe(8453);
      expect(config.legs[1]!.amount).toBe('5000000000000000000');
      expect(config.legs[1]!.recipientAddress).toBe('0x1234567890abcdef1234567890abcdef12345678');

      // Leg 2: DEX on Base
      expect(config.legs[2]).toEqual({
        legIndex: 2,
        legType: 'dex',
        chainId: 8453,
        targetQuantity: 100,
        venueKey: 'uniswap-v3',
      });

      // Audit should be recorded
      expect(mockAudit.record).toHaveBeenCalledTimes(1);
      expect(mockAudit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'CreateMultiLegPlan',
          resourceType: 'ExecutionPlan',
          payload: expect.objectContaining({
            legCount: 3,
            isCrossChain: true,
          }),
        }),
      );
    });

    it('should create a cross-chain plan with native bridge (ETH → Arb)', async () => {
      const dto: CreateMultiLegPlanDto = {
        legs: [
          makeDexLeg({ chainId: 1, venueKey: 'uniswap-v3' }),
          makeBridgeLeg({
            chainId: 1,
            bridgeKey: 'native',
            destinationChainId: 42161,
            token: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
            destinationToken: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
            amount: '2000000000000000000',
          }),
          makeDexLeg({ chainId: 42161, venueKey: 'sushiswap' }),
        ],
      };

      const { config } = await service.buildMultiLegPlan(dto);

      expect(config.isCrossChain).toBe(true);
      expect(config.chainIds).toEqual([1, 42161]);
      expect(config.legs[1]!.bridgeKey).toBe('native');
    });
  });

  // ── Happy path: 5-leg with 2 bridges ──────────────────────────────

  describe('happy path: 5-leg with 2 bridges', () => {
    it('should create a 5-leg plan: DEX → bridge → DEX → bridge → DEX', async () => {
      const dto: CreateMultiLegPlanDto = {
        legs: [
          makeDexLeg({ chainId: 1, venueKey: 'uniswap-v3' }),
          makeBridgeLeg({
            chainId: 1,
            bridgeKey: 'native',
            destinationChainId: 42161,
            token: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
            destinationToken: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
            amount: '1000000000000000000',
          }),
          makeDexLeg({ chainId: 42161, venueKey: 'uniswap-v3' }),
          makeBridgeLeg({
            chainId: 42161,
            bridgeKey: 'across',
            destinationChainId: 8453,
            token: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
            destinationToken: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
            amount: '1000000000000000000',
          }),
          makeDexLeg({ chainId: 8453, venueKey: 'uniswap-v3' }),
        ],
      };

      const { config } = await service.buildMultiLegPlan(dto);

      expect(config.legs).toHaveLength(5);
      expect(config.isCrossChain).toBe(true);
      expect(config.chainIds).toEqual([1, 42161, 8453]);
      expect(config.legs[1]!.bridgeKey).toBe('native');
      expect(config.legs[3]!.bridgeKey).toBe('across');
    });
  });

  // ── Default targetQuantity ────────────────────────────────────────

  describe('default targetQuantity', () => {
    it('should default targetQuantity to 10 when not specified', async () => {
      const dto: CreateMultiLegPlanDto = {
        legs: [
          { legType: 'dex', chainId: 42161 },
          { legType: 'dex', chainId: 42161 },
        ],
      };

      const { config } = await service.buildMultiLegPlan(dto);

      expect(config.legs[0]!.targetQuantity).toBe(10);
      expect(config.legs[1]!.targetQuantity).toBe(10);
    });
  });

  // ── parsePlaybookConfig ───────────────────────────────────────────

  describe('parsePlaybookConfig', () => {
    it('should return null for null input', () => {
      expect(MultiLegPlanBuilderService.parsePlaybookConfig(null)).toBeNull();
    });

    it('should return null for undefined input', () => {
      expect(MultiLegPlanBuilderService.parsePlaybookConfig(undefined)).toBeNull();
    });

    it('should return null for wrong schemaVersion', () => {
      expect(
        MultiLegPlanBuilderService.parsePlaybookConfig({ schemaVersion: 2, legs: [] }),
      ).toBeNull();
    });

    it('should return null for missing legs array', () => {
      expect(
        MultiLegPlanBuilderService.parsePlaybookConfig({ schemaVersion: 1 }),
      ).toBeNull();
    });

    it('should return config for valid input', () => {
      const raw = {
        schemaVersion: 1,
        legs: [{ legIndex: 0, legType: 'dex', chainId: 42161, targetQuantity: 10 }],
        isCrossChain: false,
        chainIds: [42161],
      };
      const result = MultiLegPlanBuilderService.parsePlaybookConfig(raw);
      expect(result).not.toBeNull();
      expect(result!.schemaVersion).toBe(1);
      expect(result!.legs).toHaveLength(1);
    });
  });
});