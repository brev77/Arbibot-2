import { ConflictException, NotFoundException } from '@nestjs/common';

import { EVENT_NAMES } from '@arbibot/contracts';
import type {
  CapitalReservationEntity,
  OutboxEventEntity,
} from '@arbibot/persistence';
import type { DataSource, EntityManager, Repository } from 'typeorm';

import type { IAuditClient } from '@arbibot/nest-platform';

import { ReserveCapitalDto } from './dto/reserve-capital.dto';
import { CapitalService } from './capital.service';

describe('CapitalService', () => {
  let service: CapitalService;
  let reservations: CapitalReservationEntity[];
  let outbox: OutboxEventEntity[];
  const auditRecord = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    reservations = [];
    outbox = [];
    const em = {
      create: jest.fn((_Entity: unknown, row: object) => ({ ...row })),
      save: jest.fn(
        (
          _Entity: unknown,
          entity: Record<string, unknown>,
        ) => {
          const e = entity;
          if ('eventType' in e) {
            outbox.push(e as unknown as OutboxEventEntity);
            return e;
          }
          const res = e as unknown as CapitalReservationEntity;
          if (res.id === undefined || res.id === '') {
            res.id = '22222222-2222-4222-8222-222222222222';
          }
          const idx = reservations.findIndex((r) => r.id === res.id);
          if (idx >= 0) {
            reservations[idx] = res;
          } else {
            reservations.push(res);
          }
          return res;
        },
      ),
      findOne: jest.fn((_Entity: unknown, opts: { where: { id: string } }) => {
        return Promise.resolve(
          reservations.find((r) => r.id === opts.where.id) ?? null,
        );
      }),
    } as unknown as EntityManager;

    const dataSource = {
      transaction: jest.fn(async (fn: (m: EntityManager) => Promise<unknown>) => {
        return fn(em);
      }),
    } as unknown as DataSource;

    const repo = {} as unknown as Repository<CapitalReservationEntity>;
    const audit = {
      record: auditRecord,
      appendEntry: jest.fn(),
    } as unknown as IAuditClient;
    service = new CapitalService(dataSource, repo, audit);
  });

  function validDto(over?: Partial<ReserveCapitalDto>): ReserveCapitalDto {
    const dto = new ReserveCapitalDto();
    dto.correlationId = '550e8400-e29b-41d4-a716-446655440000';
    dto.amountUsd = 1000;
    dto.planId = '11111111-1111-4111-8111-111111111111';
    return Object.assign(dto, over);
  }

  it('persists reservation and CapitalReserved outbox in one transaction', async () => {
    const row = await service.reserve(validDto());
    expect(row.id).toBe('22222222-2222-4222-8222-222222222222');
    expect(row.entityVersion).toBe(1);
    expect(outbox).toHaveLength(1);
    expect(outbox[0]?.eventType).toBe(EVENT_NAMES.capitalReserved);
    expect(outbox[0]?.entityId).toBe(row.id);
    const payload = outbox[0]?.payload as Record<string, unknown>;
    expect(payload.reservationId).toBe(row.id);
    expect(payload.correlationId).toBe('550e8400-e29b-41d4-a716-446655440000');
    expect(payload.planId).toBe('11111111-1111-4111-8111-111111111111');
    expect(payload.amountUsd).toBe(1000);
    expect(payload.entityVersion).toBe(1);
    expect(typeof payload.expiresAt).toBe('string');
    expect(auditRecord).toHaveBeenCalled();
  });

  it('release sets reservation to released (idempotent)', async () => {
    reservations.push({
      id: '44444444-4444-4444-8444-444444444444',
      planId: '11111111-1111-4111-8111-111111111111',
      correlationId: '550e8400-e29b-41d4-a716-446655440000',
      amountUsd: '100',
      state: 'active',
      expiresAt: new Date(Date.now() + 60_000),
      entityVersion: 1,
      createdAt: new Date(),
    });

    const first = await service.release('44444444-4444-4444-8444-444444444444');
    expect(first.state).toBe('released');
    expect(auditRecord).toHaveBeenCalledTimes(1);

    const second = await service.release('44444444-4444-4444-8444-444444444444');
    expect(second.state).toBe('released');
    expect(auditRecord).toHaveBeenCalledTimes(1);
  });

  it('getById throws when missing', async () => {
    const dataSource = {
      transaction: jest.fn(async (fn: (m: EntityManager) => Promise<unknown>) => {
        const em = {
          findOne: jest.fn(() => Promise.resolve(null)),
          save: jest.fn(),
        } as unknown as EntityManager;
        return fn(em);
      }),
    } as unknown as DataSource;
    const svc = new CapitalService(
      dataSource,
      {} as unknown as Repository<CapitalReservationEntity>,
      { record: jest.fn(), appendEntry: jest.fn() },
    );
    await expect(svc.getById('33333333-3333-4333-8333-333333333333')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('release rejects non-active non-released state', async () => {
    reservations.push({
      id: '55555555-5555-4555-8555-555555555555',
      planId: null,
      correlationId: '550e8400-e29b-41d4-a716-446655440000',
      amountUsd: '1',
      state: 'expired',
      expiresAt: new Date(Date.now() - 60_000),
      entityVersion: 1,
      createdAt: new Date(),
    });

    await expect(
      service.release('55555555-5555-4555-8555-555555555555'),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
