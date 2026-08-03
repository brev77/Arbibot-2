import { getArbibotMetricsRegistry } from '@arbibot/nest-platform';
import { EVENT_NAMES } from '@arbibot/contracts';
import type { DataSource } from 'typeorm';
import type { OutboxEventEntity } from '@arbibot/persistence';

import { SettlementRelayWorker } from './settlement-relay.worker';
import type { FillOutboundService, LegFilledSettlementArgs } from './fill-outbound.service';
import type { PlansService } from '../plans/plans.service';

describe('SettlementRelayWorker (P9-8)', () => {
  function buildWorker(opts: {
    rows?: Partial<OutboxEventEntity>[];
    confirmThrows?: boolean;
    releaseThrows?: boolean;
  }) {
    const rows = opts.rows ?? [];
    const updatedIds: unknown[] = [];
    // Shared em supporting both find (first tx) and update (per-row tx).
    const em = {
      find: jest.fn(() => Promise.resolve(rows)),
      update: jest.fn((_target: unknown, id: unknown) => {
        updatedIds.push(id);
        return Promise.resolve({ affected: 1 });
      }),
    };
    const dataSource = {
      transaction: jest.fn(async (fn: (em: unknown) => Promise<unknown>) => fn(em)),
    } as unknown as DataSource;
    const fillOutbound = {
      confirmPortfolioPublic: opts.confirmThrows
        ? jest.fn(() => Promise.reject(new Error('portfolio down')))
        : jest.fn(() => Promise.resolve()),
      releaseCapitalPublic: opts.releaseThrows
        ? jest.fn(() => Promise.reject(new Error('capital down')))
        : jest.fn(() => Promise.resolve()),
    } as unknown as FillOutboundService;
    const plans = {} as unknown as PlansService;
    const worker = new SettlementRelayWorker(dataSource, fillOutbound, plans);
    return { worker, fillOutbound, updatedIds };
  }

  beforeEach(() => {
    getArbibotMetricsRegistry().clear();
  });

  it('delivers a legFilled row → confirmPortfolioPublic + marks processed', async () => {
    const { worker, fillOutbound, updatedIds } = buildWorker({
      rows: [
        {
          id: 'row-1',
          eventType: EVENT_NAMES.legFilled,
          payload: { planId: 'p1', legId: 'l1', legIndex: 0, filledQuantity: 100, instrumentKey: 'k' },
          envelope: { correlationId: 'corr-1' },
        },
      ],
    });
    const delivered = await worker.drainBatch();
    expect(delivered).toBe(1);
    expect(fillOutbound.confirmPortfolioPublic).toHaveBeenCalledTimes(1);
    const args = (fillOutbound.confirmPortfolioPublic as jest.Mock).mock.calls[0][0] as LegFilledSettlementArgs;
    expect(args.legId).toBe('l1');
    expect(args.correlationId).toBe('corr-1');
    expect(updatedIds).toContain('row-1');
  });

  it('delivers a planCompleted row with reservation → releaseCapitalPublic', async () => {
    const { worker, fillOutbound } = buildWorker({
      rows: [
        {
          id: 'row-2',
          eventType: EVENT_NAMES.planCompleted,
          payload: { capitalReservationId: 'res-9' },
          envelope: {},
        },
      ],
    });
    await worker.drainBatch();
    expect(fillOutbound.releaseCapitalPublic).toHaveBeenCalledWith('res-9');
  });

  it('skips capital release when planCompleted has no reservationId', async () => {
    const { worker, fillOutbound } = buildWorker({
      rows: [
        { id: 'row-3', eventType: EVENT_NAMES.planCompleted, payload: {}, envelope: {} },
      ],
    });
    const delivered = await worker.drainBatch();
    expect(delivered).toBe(1); // marked processed (no-op)
    expect(fillOutbound.releaseCapitalPublic).not.toHaveBeenCalled();
  });

  it('does NOT mark processed when delivery fails (will retry on next cycle)', async () => {
    const { worker, updatedIds } = buildWorker({
      rows: [
        { id: 'row-4', eventType: EVENT_NAMES.legFilled, payload: { legId: 'l4' }, envelope: {} },
      ],
      confirmThrows: true,
    });
    const delivered = await worker.drainBatch();
    expect(delivered).toBe(0);
    expect(updatedIds).not.toContain('row-4');
  });

  it('returns 0 when there are no unprocessed rows', async () => {
    const { worker } = buildWorker({ rows: [] });
    expect(await worker.drainBatch()).toBe(0);
  });
});
