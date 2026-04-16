import type { Repository } from 'typeorm';

import { ReconciliationMismatchEntity } from '@arbibot/persistence';

import { MismatchesService } from './mismatches.service';

describe('MismatchesService', () => {
  it('runDetectors sums inserted rows from both detectors', async () => {
    const query = jest
      .fn()
      .mockResolvedValueOnce([{ id: '1' }])
      .mockResolvedValueOnce([{ id: '2' }, { id: '3' }]);
    const dataSource = { query } as never;
    const repo = {
      find: jest.fn(),
    } as unknown as Repository<ReconciliationMismatchEntity>;
    const svc = new MismatchesService(dataSource, repo);
    const r = await svc.runDetectors();
    expect(r.inserted).toBe(3);
    expect(r.byKind).toMatchObject({
      completed_plan_missing_portfolio: 1,
      executing_plan_legs_filled_not_completed: 2,
    });
    expect(query).toHaveBeenCalledTimes(2);
  });
});
