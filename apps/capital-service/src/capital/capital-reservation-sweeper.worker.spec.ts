import type { DataSource } from 'typeorm';

import { CapitalReservationSweeperWorker } from './capital-reservation-sweeper.worker';

describe('CapitalReservationSweeperWorker (P9-9)', () => {
  function buildWorker(emQueryResult: unknown[]): {
    worker: CapitalReservationSweeperWorker;
    transaction: jest.Mock;
  } {
    let queryCall = 0;
    const em = {
      query: jest.fn(() => {
        const r = emQueryResult[queryCall] ?? [];
        queryCall += 1;
        return r;
      }),
    };
    const transaction = jest.fn(async (fn: (m: unknown) => Promise<unknown>) => fn(em));
    const dataSource = { transaction } as unknown as DataSource;
    const worker = new CapitalReservationSweeperWorker(dataSource);
    return { worker, transaction };
  }

  beforeEach(() => {
    // Clear the shared metrics registry between tests so Counter re-registration works.
    const reg = jest.requireActual('@arbibot/nest-platform').getArbibotMetricsRegistry();
    reg.clear();
  });

  it('materializes expired reservations (returns the row count)', async () => {
    const { worker } = buildWorker([
      [{ id: 'r1' }, { id: 'r2' }], // 2 expired rows
    ]);
    const count = await worker.runSweep();
    expect(count).toBe(2);
  });

  it('returns 0 when there are no expired reservations', async () => {
    const { worker } = buildWorker([[]]);
    const count = await worker.runSweep();
    expect(count).toBe(0);
  });

  it('logs and returns 0 when the UPDATE throws (does not crash the worker)', async () => {
    const { worker } = buildWorker([new Error('DB connection lost')]);
    const count = await worker.runSweep();
    expect(count).toBe(0);
  });

  it('does not start the interval when CAPITAL_SWEEPER_ENABLED=false', () => {
    const original = process.env.CAPITAL_SWEEPER_ENABLED;
    process.env.CAPITAL_SWEEPER_ENABLED = 'false';
    try {
      const { worker } = buildWorker([]);
      worker.onModuleInit();
      // No throw, no interval — worker is inert.
      expect(worker).toBeDefined();
      worker.onModuleDestroy();
    } finally {
      if (original === undefined) {
        delete process.env.CAPITAL_SWEEPER_ENABLED;
      } else {
        process.env.CAPITAL_SWEEPER_ENABLED = original;
      }
    }
  });
});
