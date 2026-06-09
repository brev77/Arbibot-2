import { AuditClientService } from '@arbibot/nest-platform';

import { HermesMutationService } from './hermes-mutation.service';
import { HermesUpstreamService } from './hermes-upstream.service';
import { SafeModeService } from './safe-mode.service';

describe('HermesMutationService', () => {
  const makeService = (
    upstream: HermesUpstreamService,
    audit?: AuditClientService,
  ) =>
    new HermesMutationService(
      upstream,
      audit ??
        ({
          appendEntry: jest.fn().mockResolvedValue(undefined),
        } as unknown as AuditClientService),
      new SafeModeService(),
    );

  it('armPlan proxies to execution and audits on success', async () => {
    const appendEntry = jest.fn().mockResolvedValue(undefined);
    const postJson = jest
      .fn()
      .mockResolvedValue({ status: 200, json: { ok: true } });
    const upstream = { postJson } as unknown as HermesUpstreamService;
    const svc = makeService(
      upstream,
      { appendEntry } as unknown as AuditClientService,
    );
    const out = await svc.armPlan(
      'aaaaaaaa-bbbb-4ccc-dddd-eeeeeeeeeeee',
      {
        operatorId: 'op-1',
        approveReason: 'test',
      },
      'corr-1',
    );
    expect(out).toEqual({ ok: true });
    expect(postJson.mock.calls[0]?.[0]).toEqual(
      expect.stringContaining(
        '/execution/plans/aaaaaaaa-bbbb-4ccc-dddd-eeeeeeeeeeee/arm',
      ),
    );
    expect(postJson.mock.calls[0]?.[1]).toBeUndefined();
    expect(postJson.mock.calls[0]?.[2]).toBe('corr-1');
    expect(appendEntry.mock.calls.length).toBeGreaterThan(0);
  });

  it('closePosition proxies to portfolio-service', async () => {
    const appendEntry = jest.fn().mockResolvedValue(undefined);
    const postJson = jest
      .fn()
      .mockResolvedValue({ status: 200, json: { id: 'pos-1', quantity: '0' } });
    const upstream = { postJson } as unknown as HermesUpstreamService;
    const svc = makeService(
      upstream,
      { appendEntry } as unknown as AuditClientService,
    );
    const pid = 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb';
    const out = await svc.closePosition(
      pid,
      { operatorId: 'op-1', expectedEntityVersion: 2 },
      'corr-1',
    );
    expect(out).toEqual({ id: 'pos-1', quantity: '0' });
    expect(postJson.mock.calls[0]?.[0]).toContain(`/positions/${pid}/close`);
    expect(postJson.mock.calls[0]?.[1]).toMatchObject({
      operatorId: 'op-1',
      expectedEntityVersion: 2,
    });
  });

  it('enableSafeMode updates state and audits', async () => {
    const appendEntry = jest.fn().mockResolvedValue(undefined);
    const upstream = {
      postJson: jest.fn(),
    } as unknown as HermesUpstreamService;
    const svc = makeService(
      upstream,
      { appendEntry } as unknown as AuditClientService,
    );
    const res = await svc.enableSafeMode(
      { operatorId: 'op-1', reason: 't' },
      'c',
    );
    expect((res as { safeMode: { enabled: boolean } }).safeMode.enabled).toBe(
      true,
    );
    const calls = appendEntry.mock.calls as unknown[][];
    expect(calls.some((c) => (c[0] as { action?: string }).action === 'HERMES_SAFE_MODE_ENABLE')).toBe(
      true,
    );
  });
});
