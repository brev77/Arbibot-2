import { randomUUID } from 'node:crypto';

import {
  ConflictException,
  HttpException,
  HttpStatus,
  NotFoundException,
} from '@nestjs/common';

import { EVENT_NAMES } from '@arbibot/contracts';
import {
  ExecutionLegEntity,
  ExecutionLegFillIdempotencyEntity,
  ExecutionPlanEntity,
  OutboxEventEntity,
} from '@arbibot/persistence';
import type { DataSource, EntityManager, Repository } from 'typeorm';

import type { IAuditClient } from '@arbibot/nest-platform';

import { MockVenueAdapter } from '../venue/mock-venue.adapter';
import type { VenueAdapter } from '../venue/venue-adapter';
import { VenueSubmitClientError, VenueTerminalSubmitError } from '../venue/venue-adapter';
import type { FillOutboundService } from './fill-outbound.service';
import { LegsService, resolveInstrumentKeyForPlan } from './legs.service';
import type { BridgeAdapterFactoryService } from '../execution/bridge/bridge-adapter-factory.service';
import type { BridgeTransferService } from '../execution/bridge/bridge-transfer.service';

function legDefaults(): Pick<
  ExecutionLegEntity,
  'targetQuantity' | 'filledQuantity'
> {
  return { targetQuantity: 10, filledQuantity: 0 };
}

describe('LegsService', () => {
  let service: LegsService;
  const auditRecord = jest.fn();
  let plans: ExecutionPlanEntity[];
  let legs: ExecutionLegEntity[];
  let fillDedups: Array<{ legId: string; idempotencyKey: string }>;
  let outboxRows: OutboxEventEntity[];
  let venue: VenueAdapter;
  let fillOutboundSvc: { afterLegFullyFilled: jest.Mock };

  beforeEach(() => {
    plans = [];
    legs = [];
    fillDedups = [];
    outboxRows = [];
    jest.clearAllMocks();

    venue = {
      submitLeg: jest.fn(() =>
        Promise.resolve({ externalOrderId: 'mock:ext-1' }),
      ),
    };

    const em = {
      findOne: jest.fn(
        (
          Entity: unknown,
          opts: {
            where: {
              id?: string;
              planId?: string;
              legIndex?: number;
              legId?: string;
              idempotencyKey?: string;
            };
          },
        ) => {
          if (Entity === ExecutionPlanEntity) {
            return plans.find((p) => p.id === opts.where.id) ?? null;
          }
          if (Entity === ExecutionLegEntity) {
            const w = opts.where;
            if (w.id !== undefined) {
              return (
                legs.find(
                  (l) =>
                    l.id === w.id &&
                    (w.planId === undefined || l.planId === w.planId),
                ) ?? null
              );
            }
            if (w.planId !== undefined && w.legIndex !== undefined) {
              return (
                legs.find(
                  (l) => l.planId === w.planId && l.legIndex === w.legIndex,
                ) ?? null
              );
            }
            if (w.planId !== undefined) {
              return legs.find((l) => l.planId === w.planId) ?? null;
            }
            return null;
          }
          if (Entity === ExecutionLegFillIdempotencyEntity) {
            const w = opts.where;
            if (w.legId === undefined || w.idempotencyKey === undefined) {
              return null;
            }
            return (
              fillDedups.find(
                (d) =>
                  d.legId === w.legId && d.idempotencyKey === w.idempotencyKey,
              ) ?? null
            );
          }
          return null;
        },
      ),
      insert: jest.fn(
        (
          Entity: unknown,
          row: { legId: string; idempotencyKey: string },
        ) => {
          if (Entity === ExecutionLegFillIdempotencyEntity) {
            if (
              fillDedups.some(
                (d) =>
                  d.legId === row.legId &&
                  d.idempotencyKey === row.idempotencyKey,
              )
            ) {
              const err = new Error('duplicate');
              Object.assign(err, { code: '23505' });
              throw err;
            }
            fillDedups.push({
              legId: row.legId,
              idempotencyKey: row.idempotencyKey,
            });
          }
          return undefined;
        },
      ),
      create: jest.fn((_Entity: unknown, row: object) => ({ ...row })),
      save: jest.fn((a: unknown, b?: unknown) => {
        const entity = (b !== undefined ? b : a) as
          | ExecutionPlanEntity
          | ExecutionLegEntity
          | OutboxEventEntity;
        if ('eventType' in entity) {
          outboxRows.push(entity);
          return entity;
        }
        if ('legIndex' in entity) {
          const leg = { ...entity };
          if (leg.id === undefined || leg.id.length === 0) {
            leg.id = randomUUID();
          }
          const idx = legs.findIndex((l) => l.id === leg.id);
          if (idx >= 0) {
            legs[idx] = leg;
          } else {
            legs.push({
              ...leg,
              createdAt: new Date('2026-01-01'),
              updatedAt: new Date('2026-01-01'),
            } as ExecutionLegEntity);
          }
          return legs.find((l) => l.id === leg.id)!;
        }
        const plan = entity;
        const idx = plans.findIndex((p) => p.id === plan.id);
        if (idx >= 0) {
          plans[idx] = plan;
        }
        return plan;
      }),
    } as unknown as EntityManager;

    const dataSource = {
      transaction: jest.fn(async (fn: (m: EntityManager) => Promise<unknown>) =>
        fn(em),
      ),
    } as unknown as DataSource;

    const plansRepo = {
      findOne: jest.fn(({ where }: { where: { id: string } }) => {
        return plans.find((p) => p.id === where.id) ?? null;
      }),
    } as unknown as Repository<ExecutionPlanEntity>;

    const legsRepo = {
      find: jest.fn(
        ({ where }: { where: { planId: string } }) =>
          legs.filter((l) => l.planId === where.planId),
      ),
    } as unknown as Repository<ExecutionLegEntity>;

    const audit = {
      record: auditRecord,
      appendEntry: jest.fn(),
    } as unknown as IAuditClient;

    fillOutboundSvc = { afterLegFullyFilled: jest.fn() };

    const bridgeAdapterFactory = {
      resolveAdapter: jest.fn(),
    } as unknown as BridgeAdapterFactoryService;

    const bridgeTransferService = {
      submitBridgeTransfer: jest.fn(),
    } as unknown as BridgeTransferService;

    service = new LegsService(
      dataSource,
      plansRepo,
      legsRepo,
      audit,
      venue,
      fillOutboundSvc as unknown as FillOutboundService,
      bridgeAdapterFactory,
      bridgeTransferService,
    );
  });

  it('beginExecution creates leg0 with targetQuantity and sets plan executing', async () => {
    const planId = '11111111-1111-4111-8111-111111111111';
    plans.push({
      id: planId,
      state: 'armed',
      entityVersion: 3,
      correlationId: 'c1',
      capitalReservationId: 'r1',
      riskDecisionId: 'd1',
      createdAt: new Date(),
      updatedAt: new Date(),
    } as ExecutionPlanEntity);

    const out = await service.beginExecution(planId);
    expect(out.plan.state).toBe('executing');
    expect(out.legs).toHaveLength(1);
    expect(out.legs[0]?.state).toBe('created');
    expect(out.legs[0]?.targetQuantity).toBe(10);
    expect(out.legs[0]?.filledQuantity).toBe(0);
    expect(auditRecord).toHaveBeenCalled();
  });

  it('beginExecution rejects when not armed', async () => {
    const planId = '22222222-2222-4222-8222-222222222222';
    plans.push({
      id: planId,
      state: 'planned',
      entityVersion: 1,
      correlationId: null,
      capitalReservationId: null,
      riskDecisionId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as ExecutionPlanEntity);

    await expect(service.beginExecution(planId)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('markSent transitions created to sent with venue ref', async () => {
    const planId = '33333333-3333-4333-8333-333333333333';
    const legId = '44444444-4444-4444-8444-444444444444';
    plans.push({
      id: planId,
      state: 'executing',
      entityVersion: 4,
      correlationId: null,
      capitalReservationId: null,
      riskDecisionId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as ExecutionPlanEntity);
    legs.push({
      id: legId,
      planId,
      legIndex: 0,
      state: 'created',
      entityVersion: 1,
      venueRef: null,
      ...legDefaults(),
      createdAt: new Date(),
      updatedAt: new Date(),
    } as ExecutionLegEntity);

    const row = await service.markSent(planId, legId);
    expect(row.state).toBe('sent');
    expect(row.venueRef).toBe('mock:ext-1');
  });

  it('markSent moves leg to rejected when venue throws VenueTerminalSubmitError', async () => {
    venue.submitLeg = jest.fn(() =>
      Promise.reject(new VenueTerminalSubmitError('no liquidity', 'rejected')),
    );
    const planId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    const legId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
    plans.push({
      id: planId,
      state: 'executing',
      entityVersion: 1,
      correlationId: null,
      capitalReservationId: null,
      riskDecisionId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as ExecutionPlanEntity);
    legs.push({
      id: legId,
      planId,
      legIndex: 0,
      state: 'created',
      entityVersion: 1,
      venueRef: null,
      ...legDefaults(),
      createdAt: new Date(),
      updatedAt: new Date(),
    } as ExecutionLegEntity);

    const row = await service.markSent(planId, legId);
    expect(row.state).toBe('rejected');
    expect(auditRecord).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'MarkLegSentTerminal' }),
    );
  });

  it('markSent returns 422 when venue throws VenueSubmitClientError', async () => {
    venue.submitLeg = jest.fn(() =>
      Promise.reject(new VenueSubmitClientError('venue said no')),
    );
    const planId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
    const legId = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
    plans.push({
      id: planId,
      state: 'executing',
      entityVersion: 1,
      correlationId: null,
      capitalReservationId: null,
      riskDecisionId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as ExecutionPlanEntity);
    legs.push({
      id: legId,
      planId,
      legIndex: 0,
      state: 'created',
      entityVersion: 1,
      venueRef: null,
      ...legDefaults(),
      createdAt: new Date(),
      updatedAt: new Date(),
    } as ExecutionLegEntity);

    const err = await service.markSent(planId, legId).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HttpException);
    expect((err as HttpException).getStatus()).toBe(HttpStatus.UNPROCESSABLE_ENTITY);
    expect(String((err as HttpException).message)).toMatch(/venue client error/);
    expect(String((err as HttpException).message)).not.toMatch(/transient; retry/);
  });

  it('markSent returns 502 when venue throws', async () => {
    venue.submitLeg = jest.fn(() =>
      Promise.reject(new Error('circuit open')),
    );
    const planId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const legId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    plans.push({
      id: planId,
      state: 'executing',
      entityVersion: 1,
      correlationId: null,
      capitalReservationId: null,
      riskDecisionId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as ExecutionPlanEntity);
    legs.push({
      id: legId,
      planId,
      legIndex: 0,
      state: 'created',
      entityVersion: 1,
      venueRef: null,
      ...legDefaults(),
      createdAt: new Date(),
      updatedAt: new Date(),
    } as ExecutionLegEntity);

    const err = await service.markSent(planId, legId).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HttpException);
    expect((err as HttpException).getStatus()).toBe(HttpStatus.BAD_GATEWAY);
  });

  it('markAcknowledged requires sent', async () => {
    const planId = '55555555-5555-4555-8555-555555555555';
    const legId = '66666666-6666-4666-8666-666666666666';
    plans.push({
      id: planId,
      state: 'executing',
      entityVersion: 1,
      correlationId: null,
      capitalReservationId: null,
      riskDecisionId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as ExecutionPlanEntity);
    legs.push({
      id: legId,
      planId,
      legIndex: 0,
      state: 'created',
      entityVersion: 1,
      venueRef: null,
      ...legDefaults(),
      createdAt: new Date(),
      updatedAt: new Date(),
    } as ExecutionLegEntity);

    await expect(service.markAcknowledged(planId, legId)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('resolveInstrumentKeyForPlan prefers routeKey then riskDecisionId', () => {
    const withRoute = {
      id: 'a',
      routeKey: '  arb:route:x  ',
      riskDecisionId: '22222222-2222-4222-8222-222222222222',
    } as unknown as ExecutionPlanEntity;
    expect(resolveInstrumentKeyForPlan(withRoute)).toBe('arb:route:x');
    const withRisk = {
      id: 'b',
      routeKey: null,
      riskDecisionId: '33333333-3333-4333-8333-333333333333',
    } as unknown as ExecutionPlanEntity;
    expect(resolveInstrumentKeyForPlan(withRisk)).toBe(
      'arb:risk-decision:33333333-3333-4333-8333-333333333333',
    );
    const fallback = {
      id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      routeKey: null,
      riskDecisionId: null,
    } as unknown as ExecutionPlanEntity;
    expect(resolveInstrumentKeyForPlan(fallback)).toBe(
      'arb:execution-plan:cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    );
  });

  it('applyFill moves acknowledged to filled (full)', async () => {
    const planId = '77777777-7777-4777-8777-777777777777';
    const legId = '88888888-8888-4888-8888-888888888888';
    plans.push({
      id: planId,
      state: 'executing',
      entityVersion: 1,
      correlationId: null,
      capitalReservationId: null,
      riskDecisionId: null,
      routeKey: null,
      playbookConfig: null,
      legs: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    } as ExecutionPlanEntity);
    legs.push({
      id: legId,
      planId,
      legIndex: 0,
      state: 'acknowledged',
      entityVersion: 2,
      venueRef: 'x',
      ...legDefaults(),
      createdAt: new Date(),
      updatedAt: new Date(),
    } as ExecutionLegEntity);

    const row = await service.applyFill(planId, legId, {
      idempotencyKey: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    });
    expect(row.state).toBe('filled');
    expect(row.filledQuantity).toBe(10);
    expect(fillDedups).toHaveLength(1);
    expect(outboxRows).toHaveLength(1);
    expect(outboxRows[0]?.eventType).toBe(EVENT_NAMES.legFilled);
    expect(fillOutboundSvc.afterLegFullyFilled).toHaveBeenCalledWith(
      expect.objectContaining({
        instrumentKey: 'arb:execution-plan:77777777-7777-4777-8777-777777777777',
      }),
    );
  });

  it('applyFill partial then full completes leg', async () => {
    const planId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
    const legId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
    plans.push({
      id: planId,
      state: 'executing',
      entityVersion: 1,
      correlationId: null,
      capitalReservationId: null,
      riskDecisionId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as ExecutionPlanEntity);
    legs.push({
      id: legId,
      planId,
      legIndex: 0,
      state: 'acknowledged',
      entityVersion: 2,
      venueRef: 'x',
      ...legDefaults(),
      createdAt: new Date(),
      updatedAt: new Date(),
    } as ExecutionLegEntity);

    const p1 = await service.applyFill(planId, legId, {
      mode: 'partial',
      cumulativeFilled: 4,
      idempotencyKey: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
    });
    expect(p1.state).toBe('partiallyFilled');
    expect(p1.filledQuantity).toBe(4);

    const p2 = await service.applyFill(planId, legId, {
      mode: 'partial',
      cumulativeFilled: 10,
      idempotencyKey: '11111111-1111-4111-8111-111111111112',
    });
    expect(p2.state).toBe('filled');
    expect(p2.filledQuantity).toBe(10);
    expect(outboxRows).toHaveLength(1);
    expect(outboxRows[0]?.eventType).toBe(EVENT_NAMES.legFilled);
  });

  it('applyFill with same idempotencyKey is replay-safe', async () => {
    const planId = '12121212-1212-4121-8121-121212121212';
    const legId = '13131313-1313-4131-8131-131313131313';
    plans.push({
      id: planId,
      state: 'executing',
      entityVersion: 1,
      correlationId: null,
      capitalReservationId: null,
      riskDecisionId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as ExecutionPlanEntity);
    legs.push({
      id: legId,
      planId,
      legIndex: 0,
      state: 'acknowledged',
      entityVersion: 2,
      venueRef: 'x',
      ...legDefaults(),
      createdAt: new Date(),
      updatedAt: new Date(),
    } as ExecutionLegEntity);

    const key = '14141414-1414-4141-8141-141414141414';
    const a = await service.applyFill(planId, legId, { idempotencyKey: key });
    const b = await service.applyFill(planId, legId, { idempotencyKey: key });
    expect(b.state).toBe('filled');
    expect(b.entityVersion).toBe(a.entityVersion);
    expect(auditRecord).toHaveBeenCalledTimes(1);
    expect(outboxRows).toHaveLength(1);
  });

  it('beginExecution creates multiple legs when EXECUTION_BEGIN_LEG_COUNT>1', async () => {
    process.env.EXECUTION_BEGIN_LEG_COUNT = '2';
    const planId = 'abababab-abab-4bab-8bab-abababababab';
    plans.push({
      id: planId,
      state: 'armed',
      entityVersion: 1,
      correlationId: 'c-multi',
      capitalReservationId: null,
      riskDecisionId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as ExecutionPlanEntity);

    const out = await service.beginExecution(planId);
    expect(out.legs).toHaveLength(2);
    expect(out.legs.map((l) => l.legIndex).sort()).toEqual([0, 1]);
    delete process.env.EXECUTION_BEGIN_LEG_COUNT;
  });

  it('e2e two legs: both fill then plan can complete (outbound mocked)', async () => {
    process.env.EXECUTION_BEGIN_LEG_COUNT = '2';
    const planId = 'bcbcbcbc-bcbc-4cbc-8cbc-bcbcbcbcbcbc';
    plans.push({
      id: planId,
      state: 'armed',
      entityVersion: 1,
      correlationId: 'c-2leg',
      capitalReservationId: null,
      riskDecisionId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as ExecutionPlanEntity);

    const begin = await service.beginExecution(planId);
    const leg0 = begin.legs.find((l) => l.legIndex === 0)?.id;
    const leg1 = begin.legs.find((l) => l.legIndex === 1)?.id;
    if (leg0 === undefined || leg1 === undefined) {
      throw new Error('expected two legs');
    }

    for (const id of [leg0, leg1]) {
      await service.markSent(planId, id);
      await service.markAcknowledged(planId, id);
      await service.applyFill(planId, id, {
        idempotencyKey: randomUUID(),
      });
    }
    expect(outboxRows.filter((o) => o.eventType === EVENT_NAMES.legFilled)).toHaveLength(2);
    delete process.env.EXECUTION_BEGIN_LEG_COUNT;
  });

  it('e2e: begin → sent → ack → filled', async () => {
    const planId = '15151515-1515-4151-8151-151515151515';
    plans.push({
      id: planId,
      state: 'armed',
      entityVersion: 1,
      correlationId: 'corr-e2e',
      capitalReservationId: null,
      riskDecisionId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as ExecutionPlanEntity);

    const begin = await service.beginExecution(planId);
    const createdId = begin.legs[0]?.id;
    if (createdId === undefined) {
      throw new Error('expected leg id');
    }
    expect(createdId).toEqual(expect.any(String));

    const sent = await service.markSent(planId, createdId);
    expect(sent.state).toBe('sent');

    const ack = await service.markAcknowledged(planId, createdId);
    expect(ack.state).toBe('acknowledged');

    const filled = await service.applyFill(planId, createdId, {
      idempotencyKey: '17171717-1717-4171-8171-171717171717',
    });
    expect(filled.state).toBe('filled');
    expect(filled.filledQuantity).toBe(10);
    expect(outboxRows).toHaveLength(1);
    expect(outboxRows[0]?.eventType).toBe(EVENT_NAMES.legFilled);
  });

  it('listForPlan throws when plan missing', async () => {
    await expect(
      service.listForPlan('99999999-9999-4999-8999-999999999999'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('MockVenueAdapter', () => {
  beforeEach(() => {
    delete process.env.MOCK_VENUE_FAIL_SUBMIT_REMAINING;
    delete process.env.MOCK_VENUE_TERMINAL_LEG_INDEX;
    delete process.env.MOCK_VENUE_TERMINAL_STATE;
  });

  const plan = { id: 'p1' } as ExecutionPlanEntity;
  const leg = { id: 'l1' } as ExecutionLegEntity;

  it('returns mock external id when failures not configured', async () => {
    const a = new MockVenueAdapter();
    const r = await a.submitLeg(plan, leg);
    expect(r.externalOrderId).toMatch(/^mock:l1:/);
  });

  it('rejects once when MOCK_VENUE_FAIL_SUBMIT_REMAINING=1 then succeeds', async () => {
    process.env.MOCK_VENUE_FAIL_SUBMIT_REMAINING = '1';
    const a = new MockVenueAdapter();
    await expect(a.submitLeg(plan, leg)).rejects.toThrow(/injected failure/i);
    const r = await a.submitLeg(plan, leg);
    expect(r.externalOrderId).toMatch(/^mock:l1:/);
    delete process.env.MOCK_VENUE_FAIL_SUBMIT_REMAINING;
  });

  it('rejects with VenueTerminalSubmitError when terminal env matches leg index', async () => {
    process.env.MOCK_VENUE_TERMINAL_LEG_INDEX = '0';
    process.env.MOCK_VENUE_TERMINAL_STATE = 'timed_out';
    const a = new MockVenueAdapter();
    const leg0 = { ...leg, legIndex: 0 } as ExecutionLegEntity;
    await expect(a.submitLeg(plan, leg0)).rejects.toMatchObject({
      name: 'VenueTerminalSubmitError',
      terminalState: 'timedOut',
    });
    const leg1 = { ...leg, legIndex: 1 } as ExecutionLegEntity;
    const r = await a.submitLeg(plan, leg1);
    expect(r.externalOrderId).toMatch(/^mock:l1:/);
  });
});
