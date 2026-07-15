/* eslint-disable @typescript-eslint/no-explicit-any */
import { ConflictException, NotFoundException } from '@nestjs/common';

import type {
  PortfolioPositionEntity,
  PortfolioPositionFillIdempotencyEntity,
  PortfolioPositionCloseIdempotencyEntity,
} from '@arbibot/persistence';
import type { DataSource, EntityManager } from 'typeorm';

import type { ClosePositionDto } from './dto/close-position.dto';
import type { ConfirmFillDto } from './dto/confirm-fill.dto';
import { PositionsService } from './positions.service';

/**
 * D4-B-3-CEILING — PositionsService is the single-writer for
 * portfolio_positions.notional_usd. These tests pin the accumulation contract
 * that capital-service relies on for the aggregate ceiling SUM.
 *
 * The mock EntityManager mirrors the shape used by capital.service.spec.ts:
 * an in-memory store keyed so `findOne`/`save`/`insert` cooperate, with a
 * `query` stub added for parity (not exercised here — positions writes only).
 */
describe('PositionsService', () => {
  let service: PositionsService;
  let positions: PortfolioPositionEntity[];
  let fillDedup: PortfolioPositionFillIdempotencyEntity[];
  let closeDedup: PortfolioPositionCloseIdempotencyEntity[];
  const auditAppendEntry = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    positions = [];
    fillDedup = [];
    closeDedup = [];

    const em = {
      create: jest.fn((_Entity: unknown, row: object) => ({ ...row })),
      save: jest.fn((...args: unknown[]) => {
        // positions.service calls em.save(pos) (single-arg). capital-style
        // em.save(Entity, row) is also handled. Normalise to the entity object.
        const entity = (args.length <= 1 ? args[0] : args[1]) as Record<string, unknown>;
        const e = entity as unknown as PortfolioPositionEntity;
        if (e.id === undefined) {
          e.id = 'pos-00000000-0000-4000-8000-000000000001';
        }
        const idx = positions.findIndex((p) => p.id === e.id);
        if (idx >= 0) {
          positions[idx] = e;
        } else {
          positions.push(e);
        }
        return Promise.resolve(e);
      }),
      insert: jest.fn((_Entity: unknown, row: Record<string, unknown>) => {
        const legId = (row as { legId?: unknown }).legId;
        const positionId = (row as { positionId?: unknown }).positionId;
        if (legId !== undefined) {
          fillDedup.push(row as unknown as PortfolioPositionFillIdempotencyEntity);
        } else if (positionId !== undefined) {
          closeDedup.push(row as unknown as PortfolioPositionCloseIdempotencyEntity);
        }
        return Promise.resolve();
      }),
      findOne: jest.fn(
        (
          _Entity: unknown,
          opts: { where: Record<string, unknown>; lock?: unknown },
        ) => {
          // Route to the correct in-memory store by the shape of the where
          // clause: fill-dedup uses { legId, idempotencyKey }, close-dedup
          // uses { positionId, idempotencyKey }, positions use anything else
          // ({ id } | { planId, instrumentKey }).
          const where = opts.where as Record<string, unknown>;
          let store: Array<Record<string, unknown>>;
          if ('legId' in where && 'idempotencyKey' in where) {
            store = fillDedup as unknown as Array<Record<string, unknown>>;
          } else if ('positionId' in where && 'idempotencyKey' in where) {
            store = closeDedup as unknown as Array<Record<string, unknown>>;
          } else {
            store = positions as unknown as Array<Record<string, unknown>>;
          }
          const found = store.find((row) =>
            Object.entries(where).every(([k, v]) => row[k] === v),
          );
          return Promise.resolve(found ?? null);
        },
      ),
    } as unknown as EntityManager;

    const dataSource = {
      transaction: jest.fn(async (fn: (m: EntityManager) => Promise<unknown>) => fn(em)),
    } as unknown as DataSource;

    service = new PositionsService(dataSource, {} as any, {
      appendEntry: auditAppendEntry,
    } as any);
  });

  function fillDto(over?: Partial<ConfirmFillDto>): ConfirmFillDto {
    return {
      planId: '11111111-1111-4111-8111-111111111111',
      legId: '22222222-2222-4222-8222-222222222222',
      instrumentKey: 'USDC-WETH-univ2',
      quantity: '1000000000000000000',
      notionalUsd: '2500',
      idempotencyKey: 'portfolio:fill:22222222-2222-4222-8222-222222222222',
      ...over,
    };
  }

  function closeDto(over?: Partial<ClosePositionDto>): ClosePositionDto {
    return {
      operatorId: 'operator-1',
      idempotencyKey: 'close-key-1',
      ...over,
    };
  }

  // ── confirmFill — notional accumulation (D4-B-3-CEILING) ──────────────

  it('creates a position and accumulates notionalUsd on first fill', async () => {
    await service.confirmFill(fillDto({ notionalUsd: '2500' }));

    expect(positions).toHaveLength(1);
    expect(positions[0]!.quantity).toBe('1000000000000000000');
    expect(positions[0]!.notionalUsd).toBe('2500');
    expect(fillDedup).toHaveLength(1);
  });

  it('adds notionalUsd on subsequent fills for the same (planId, instrumentKey)', async () => {
    await service.confirmFill(fillDto({ notionalUsd: '2500' }));
    await service.confirmFill(
      fillDto({
        legId: '33333333-3333-4333-8333-333333333333',
        quantity: '500000000000000000',
        notionalUsd: '1250.5',
        idempotencyKey: 'portfolio:fill:33333333-3333-4333-8333-333333333333',
      }),
    );

    expect(positions).toHaveLength(1);
    // 1000000000000000000 + 500000000000000000 = 1500000000000000000
    expect(positions[0]!.quantity).toBe('1500000000000000000');
    // 2500 + 1250.5 = 3750.5
    expect(positions[0]!.notionalUsd).toBe('3750.5');
    expect(fillDedup).toHaveLength(2);
  });

  it('defaults notionalUsd to 0 when the caller omits it (backward-compat)', async () => {
    await service.confirmFill(fillDto({ notionalUsd: undefined }));

    expect(positions).toHaveLength(1);
    expect(positions[0]!.quantity).toBe('1000000000000000000');
    expect(positions[0]!.notionalUsd).toBe('0');
  });

  it('is idempotent on (legId, idempotencyKey) — second call does not double-count', async () => {
    const dto = fillDto({ notionalUsd: '2500' });
    await service.confirmFill(dto);
    await service.confirmFill(dto); // identical idempotencyKey/legId

    expect(positions).toHaveLength(1);
    expect(positions[0]!.quantity).toBe('1000000000000000000');
    expect(positions[0]!.notionalUsd).toBe('2500');
    expect(fillDedup).toHaveLength(1);
  });

  // ── close — quantity → 0 (excludes row from capital ceiling SUM) ──────

  it('close sets quantity to 0 and bumps entityVersion', async () => {
    await service.confirmFill(fillDto({ notionalUsd: '2500' }));
    const positionId = positions[0]!.id;

    const closed = await service.close(positionId, closeDto());

    expect(closed.quantity).toBe('0');
    expect(closed.entityVersion).toBeGreaterThan(1);
    expect(auditAppendEntry).toHaveBeenCalled();
    expect(closeDedup).toHaveLength(1);
  });

  it('close is idempotent via idempotencyKey (returns the already-zero row)', async () => {
    await service.confirmFill(fillDto());
    const positionId = positions[0]!.id;

    await service.close(positionId, closeDto());
    const second = await service.close(positionId, closeDto());

    expect(second.quantity).toBe('0');
    // appendEntry for PORTFOLIO_POSITION_CLOSED runs once; the idempotent
    // re-close returns without re-writing.
    expect(closeDedup).toHaveLength(1);
  });

  it('close throws NotFound for an unknown position', async () => {
    await expect(
      service.close('99999999-9999-4999-8999-999999999999', closeDto()),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('close rejects on expectedEntityVersion mismatch', async () => {
    await service.confirmFill(fillDto());
    const positionId = positions[0]!.id;

    await expect(
      service.close(positionId, closeDto({ expectedEntityVersion: 999 })),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
