import { HttpStatus } from '@nestjs/common';

import { PlansController } from './plans.controller';
import type { DexPlanEnrichment } from './plans.service';
import { PlansService } from './plans.service';
import { MultiLegPlanBuilderService } from './multi-leg-plan-builder.service';

/**
 * PlansController spec (Phase 4 — controller coverage).
 *
 * The controller exposes 7 handlers over PlansService + MultiLegPlanBuilderService.
 * Each handler is a thin adapter that calls the service, optionally enriches
 * with DEX data, and projects the row to a planView / onChainTxView payload.
 * We assert delegation, ISO-date projection, and decorator metadata
 * (@HttpCode on mutating endpoints). All collaborators are stubbed.
 */
describe('PlansController', () => {
  const ISO = '2026-07-17T10:00:00.000Z';
  const mkDate = () => new Date(ISO);

  const mkRow = (overrides: Partial<Record<string, unknown>> = {}) => ({
    id: 'aaaaaaaa-bbbb-4ccc-dddd-eeeeeeeeeeee',
    state: 'created',
    correlationId: 'corr-1',
    capitalReservationId: 'cap-1',
    riskDecisionId: 'risk-1',
    routeKey: 'BTC-USDT',
    entityVersion: 1,
    createdAt: mkDate(),
    updatedAt: mkDate(),
    ...overrides,
  });

  const mkDex = (overrides: Partial<DexPlanEnrichment> = {}): DexPlanEnrichment => ({
    venueType: null,
    chainId: null,
    dexAdapter: null,
    txHash: null,
    txStatus: null,
    gasUsedWei: null,
    gasCostUsd: null,
    ...overrides,
  });

  let service: {
    create: jest.Mock;
    getById: jest.Mock;
    getDexEnrichment: jest.Mock;
    list: jest.Mock;
    linkReservation: jest.Mock;
    arm: jest.Mock;
    getLegs: jest.Mock;
    getOnChainTxsForPlan: jest.Mock;
  };
  let multiLegBuilder: { buildMultiLegPlan: jest.Mock };
  let controller: PlansController;

  beforeEach(() => {
    service = {
      create: jest.fn(),
      getById: jest.fn(),
      getDexEnrichment: jest.fn(),
      list: jest.fn(),
      linkReservation: jest.fn(),
      arm: jest.fn(),
      getLegs: jest.fn(),
      getOnChainTxsForPlan: jest.fn(),
    };
    multiLegBuilder = { buildMultiLegPlan: jest.fn() };
    controller = new PlansController(
      service as unknown as PlansService,
      multiLegBuilder as unknown as MultiLegPlanBuilderService,
    );
  });

  describe('create', () => {
    it('returns planView with ISO dates and DEX enrichment on 201', async () => {
      const row = mkRow();
      service.create.mockResolvedValue(row);
      service.getDexEnrichment.mockResolvedValue(mkDex());
      const body = { routeKey: 'BTC-USDT' };
      const out = await controller.create(body);
      expect(service.create).toHaveBeenCalledWith(body);
      expect(out.id).toBe(row.id);
      expect(out.state).toBe('created');
      expect(out.createdAt).toBe(ISO);
      expect(out.updatedAt).toBe(ISO);
      expect(out.venueType).toBeNull();
    });

    it('forwards DEX enrichment fields into planView', async () => {
      service.create.mockResolvedValue(mkRow());
      service.getDexEnrichment.mockResolvedValue(
        mkDex({
          venueType: 'dex',
          chainId: 1,
          dexAdapter: 'uniswap-v2',
          txHash: '0xabc',
          txStatus: 'confirmed',
          gasUsedWei: '21000',
          gasCostUsd: '1.5',
        }),
      );
      const out = await controller.create({ routeKey: 'WETH-USDC' });
      expect(out.venueType).toBe('dex');
      expect(out.chainId).toBe(1);
      expect(out.txHash).toBe('0xabc');
      expect(out.gasCostUsd).toBe('1.5');
    });

    it('HttpCode(201) decorator is applied', () => {
      expect(Reflect.getMetadata('__httpCode__', controller.create)).toBe(
        HttpStatus.CREATED,
      );
    });
  });

  describe('createMultiLeg', () => {
    it('builds via MultiLegPlanBuilderService and enriches with playbookConfig', async () => {
      const plan = mkRow({ state: 'armed' });
      const config = { legs: [] };
      multiLegBuilder.buildMultiLegPlan.mockResolvedValue({ plan, config });
      service.getDexEnrichment.mockResolvedValue(mkDex());
      const body = {
        routeKey: 'BTC-USDT',
        legs: [
          {
            legType: 'dex' as const,
            chainId: 42161,
            venueKey: 'uniswap-v3',
          },
        ],
      };
      const out = await controller.createMultiLeg(body);
      expect(multiLegBuilder.buildMultiLegPlan).toHaveBeenCalledWith(body);
      expect(out.id).toBe(plan.id);
      expect(out.playbookConfig).toBe(config);
    });

    it('HttpCode(201) decorator is applied', () => {
      expect(
        Reflect.getMetadata('__httpCode__', controller.createMultiLeg),
      ).toBe(HttpStatus.CREATED);
    });
  });

  describe('list', () => {
    it('returns enriched items wrapped in { items: [...] }', async () => {
      const rows = [mkRow({ id: 'p1' }), mkRow({ id: 'p2' })];
      service.list.mockResolvedValue(rows);
      service.getDexEnrichment.mockResolvedValue(mkDex());
      const out = await controller.list();
      expect(service.getDexEnrichment).toHaveBeenCalledTimes(2);
      expect(out.items).toHaveLength(2);
      expect(out.items.map((i) => i.id)).toEqual(['p1', 'p2']);
    });

    it('returns empty items when service returns empty', async () => {
      service.list.mockResolvedValue([]);
      const out = await controller.list();
      expect(out.items).toEqual([]);
    });
  });

  describe('getOne', () => {
    it('returns planView for a single UUID', async () => {
      service.getById.mockResolvedValue(mkRow());
      service.getDexEnrichment.mockResolvedValue(mkDex());
      const out = await controller.getOne(
        'aaaaaaaa-bbbb-4ccc-dddd-eeeeeeeeeeee',
      );
      expect(service.getById).toHaveBeenCalledWith(
        'aaaaaaaa-bbbb-4ccc-dddd-eeeeeeeeeeee',
      );
      expect(out.id).toBe('aaaaaaaa-bbbb-4ccc-dddd-eeeeeeeeeeee');
    });
  });

  describe('link', () => {
    it('links reservation and returns planView', async () => {
      const row = mkRow({ capitalReservationId: 'cap-new' });
      service.linkReservation.mockResolvedValue(row);
      service.getDexEnrichment.mockResolvedValue(mkDex());
      const body = { capitalReservationId: 'cap-new' };
      const out = await controller.link(
        'aaaaaaaa-bbbb-4ccc-dddd-eeeeeeeeeeee',
        body,
      );
      expect(service.linkReservation).toHaveBeenCalledWith(
        'aaaaaaaa-bbbb-4ccc-dddd-eeeeeeeeeeee',
        'cap-new',
      );
      expect(out.capitalReservationId).toBe('cap-new');
    });

    it('HttpCode(200) decorator is applied', () => {
      expect(Reflect.getMetadata('__httpCode__', controller.link)).toBe(
        HttpStatus.OK,
      );
    });
  });

  describe('arm', () => {
    it('arms the plan and returns planView', async () => {
      service.arm.mockResolvedValue(mkRow({ state: 'armed' }));
      service.getDexEnrichment.mockResolvedValue(mkDex());
      const out = await controller.arm(
        'aaaaaaaa-bbbb-4ccc-dddd-eeeeeeeeeeee',
      );
      expect(service.arm).toHaveBeenCalledWith(
        'aaaaaaaa-bbbb-4ccc-dddd-eeeeeeeeeeee',
      );
      expect(out.state).toBe('armed');
    });

    it('HttpCode(200) decorator is applied', () => {
      expect(Reflect.getMetadata('__httpCode__', controller.arm)).toBe(
        HttpStatus.OK,
      );
    });
  });

  describe('getLegs', () => {
    it('maps leg rows to legView with ISO dates', async () => {
      service.getLegs.mockResolvedValue([
        {
          id: 'leg-1',
          planId: 'p1',
          legIndex: 0,
          state: 'pending',
          entityVersion: 1,
          venueRef: 'BINANCE',
          targetQuantity: '1.5',
          filledQuantity: '0',
          createdAt: mkDate(),
          updatedAt: mkDate(),
        },
      ]);
      const out = await controller.getLegs(
        'aaaaaaaa-bbbb-4ccc-dddd-eeeeeeeeeeee',
      );
      expect(out.items).toHaveLength(1);
      expect(out.items[0]?.id).toBe('leg-1');
      expect(out.items[0]?.createdAt).toBe(ISO);
      expect(out.items[0]?.updatedAt).toBe(ISO);
    });

    it('returns empty items when no legs', async () => {
      service.getLegs.mockResolvedValue([]);
      const out = await controller.getLegs(
        'aaaaaaaa-bbbb-4ccc-dddd-eeeeeeeeeeee',
      );
      expect(out.items).toEqual([]);
    });
  });

  describe('getOnChainTxs', () => {
    it('maps on-chain tx rows to onChainTxView with ISO dates and null confirmedAt', async () => {
      service.getOnChainTxsForPlan.mockResolvedValue([
        {
          id: 'tx-1',
          txHash: '0xabc',
          chainId: 1,
          legId: 'leg-1',
          fromAddress: '0xfrom',
          toAddress: '0xto',
          value: '0',
          gasLimit: '21000',
          gasUsed: null,
          gasPrice: '1000000000',
          maxPriorityFeePerGas: null,
          maxFeePerGas: null,
          status: 'pending',
          blockNumber: null,
          blockHash: null,
          transactionIndex: null,
          confirmations: 0,
          confirmedAt: null,
          revertReason: null,
          errorMessage: null,
          nonce: 5,
          createdAt: mkDate(),
          updatedAt: mkDate(),
        },
      ]);
      const out = await controller.getOnChainTxs(
        'aaaaaaaa-bbbb-4ccc-dddd-eeeeeeeeeeee',
      );
      expect(out.items).toHaveLength(1);
      expect(out.items[0]?.id).toBe('tx-1');
      expect(out.items[0]?.txHash).toBe('0xabc');
      expect(out.items[0]?.confirmedAt).toBeNull();
      expect(out.items[0]?.createdAt).toBe(ISO);
      expect(out.items[0]?.nonce).toBe(5);
    });

    it('projects confirmedAt to ISO when set', async () => {
      service.getOnChainTxsForPlan.mockResolvedValue([
        {
          id: 'tx-2',
          txHash: '0xdef',
          chainId: 137,
          legId: 'leg-2',
          fromAddress: '0xfrom',
          toAddress: '0xto',
          value: '0',
          gasLimit: '21000',
          gasUsed: '21000',
          gasPrice: '1000000000',
          maxPriorityFeePerGas: null,
          maxFeePerGas: null,
          status: 'confirmed',
          blockNumber: 100,
          blockHash: '0xblock',
          transactionIndex: 0,
          confirmations: 12,
          confirmedAt: mkDate(),
          revertReason: null,
          errorMessage: null,
          nonce: 6,
          createdAt: mkDate(),
          updatedAt: mkDate(),
        },
      ]);
      const out = await controller.getOnChainTxs(
        'aaaaaaaa-bbbb-4ccc-dddd-eeeeeeeeeeee',
      );
      expect(out.items[0]?.confirmedAt).toBe(ISO);
      expect(out.items[0]?.confirmations).toBe(12);
    });
  });
});
