import type { Repository } from 'typeorm';

import { ReconciliationMismatchEntity } from '@arbibot/persistence';

import { MismatchesService } from './mismatches.service';

describe('MismatchesService', () => {
  it('runDetectors sums inserted rows from all detectors', async () => {
    const query = jest
      .fn()
      // Legacy detector 1: completed_plan_missing_portfolio
      .mockResolvedValueOnce([{ id: '1' }])
      // Legacy detector 2: executing_plan_legs_filled_not_completed
      .mockResolvedValueOnce([{ id: '2' }, { id: '3' }])
      // DEX detector 1: dex_receipt_leg_mismatch
      .mockResolvedValueOnce([{ id: '4' }])
      // DEX detector 2: wallet_balance_drift
      .mockResolvedValueOnce([])
      // DEX detector 3: dex_stale_pending_tx
      .mockResolvedValueOnce([{ id: '5' }, { id: '6' }]);
    const dataSource = { query } as never;
    const repo = {
      find: jest.fn(),
    } as unknown as Repository<ReconciliationMismatchEntity>;
    const svc = new MismatchesService(dataSource, repo);
    const r = await svc.runDetectors();
    expect(r.inserted).toBe(6);
    expect(r.byKind).toMatchObject({
      completed_plan_missing_portfolio: 1,
      executing_plan_legs_filled_not_completed: 2,
      dex_receipt_leg_mismatch: 1,
      wallet_balance_drift: 0,
      dex_stale_pending_tx: 2,
    });
    // 2 legacy + 3 DEX detectors = 5 total query calls
    expect(query).toHaveBeenCalledTimes(5);
  });
});
