import { HttpException } from '@nestjs/common';

import { HermesController } from './hermes.controller';
import { HermesUpstreamService } from './hermes-upstream.service';
import { IncidentBriefsService } from './incident-briefs.service';
import { SafeModeService } from './safe-mode.service';

/**
 * HermesController spec (Phase 4 — hermes-gateway read API coverage).
 *
 * The controller is a thin read-through proxy: it builds a URL from env-derived
 * bases, calls HermesUpstreamService.getJson, and either returns the JSON or
 * throws HttpException on upstream >=400. Cursor pagination over /plans has
 * real logic worth exercising. All collaborators are stubbed.
 */
describe('HermesController', () => {
  let controller: HermesController;
  let upstream: { getJson: jest.Mock };
  let incidentBriefs: { buildBriefs: jest.Mock };
  let safeMode: { getState: jest.Mock };

  const req = (correlationId?: string) => ({ correlationId });

  beforeEach(() => {
    upstream = { getJson: jest.fn() };
    incidentBriefs = { buildBriefs: jest.fn() };
    safeMode = { getState: jest.fn() };
    controller = new HermesController(
      upstream as unknown as HermesUpstreamService,
      incidentBriefs as unknown as IncidentBriefsService,
      safeMode as unknown as SafeModeService,
    );
  });

  describe('listPlans', () => {
    it('returns a first page with default limit 50 and a nextCursor when more exist', async () => {
      const items = Array.from({ length: 60 }, (_, i) => ({ id: `p${i}` }));
      upstream.getJson.mockResolvedValue({ status: 200, json: { items } });

      const result = await controller.listPlans(req('c1'));

      expect(upstream.getJson).toHaveBeenCalledWith(
        expect.stringContaining('/execution/plans'),
        'c1',
      );
      expect(result.limit).toBe(50);
      expect(result.items).toHaveLength(50);
      // 60 items, first page of 50 -> nextCursor points at id of the 50th item.
      expect(result.nextCursor).toBe('p49');
    });

    it('returns nextCursor=null when all items fit on the page', async () => {
      upstream.getJson.mockResolvedValue({
        status: 200,
        json: { items: [{ id: 'a' }, { id: 'b' }] },
      });

      const result = await controller.listPlans(req());

      expect(result.items).toHaveLength(2);
      expect(result.nextCursor).toBeNull();
      expect(result.limit).toBe(50);
    });

    it('clamps explicit limit to [1, 100]', async () => {
      upstream.getJson.mockResolvedValue({ status: 200, json: { items: [] } });

      const tooHigh = await controller.listPlans(req(), '999');
      expect(tooHigh.limit).toBe(100);

      const tooLow = await controller.listPlans(req(), '0');
      expect(tooLow.limit).toBe(1);
    });

    it('falls back to limit 50 on non-numeric or empty limit', async () => {
      upstream.getJson.mockResolvedValue({ status: 200, json: { items: [] } });

      expect((await controller.listPlans(req(), 'abc')).limit).toBe(50);
      expect((await controller.listPlans(req(), '')).limit).toBe(50);
    });

    it('starts after the cursor when it matches a plan id', async () => {
      upstream.getJson.mockResolvedValue({
        status: 200,
        json: { items: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] },
      });

      const result = await controller.listPlans(req(), '10', 'a');

      expect(result.items).toEqual([{ id: 'b' }, { id: 'c' }]);
      expect(result.nextCursor).toBeNull();
    });

    it('throws HttpException 400 when cursor does not match any plan id', async () => {
      upstream.getJson.mockResolvedValue({
        status: 200,
        json: { items: [{ id: 'a' }] },
      });

      await expect(controller.listPlans(req(), '10', 'missing')).rejects.toThrow(
        HttpException,
      );
      await expect(controller.listPlans(req(), '10', 'missing')).rejects.toThrow(
        /cursor does not match/,
      );
    });

    it('coerces non-string plan ids (number/boolean) to cursor strings', async () => {
      // Items with number/boolean ids + a missing id -> pagination still works.
      upstream.getJson.mockResolvedValue({
        status: 200,
        json: { items: [{ id: 5 }, { id: true }, { noId: true }, { id: 'last' }] },
      });

      const result = await controller.listPlans(req(), '2', '5');

      // Cursor '5' matches index 0 -> start at 1, take 2 -> [{id:true}, {noId}]
      expect(result.items).toEqual([{ id: true }, { noId: true }]);
    });

    it('throws HttpException with upstream status when getJson returns >=400', async () => {
      upstream.getJson.mockResolvedValue({
        status: 503,
        json: { error: 'upstream-down' },
      });

      await expect(controller.listPlans(req())).rejects.toThrow(HttpException);
      try {
        await controller.listPlans(req());
      } catch (e) {
        expect((e as HttpException).getStatus()).toBe(503);
      }
    });

    it('treats non-object / non-array upstream body as empty items list', async () => {
      upstream.getJson.mockResolvedValue({ status: 200, json: null });

      const result = await controller.listPlans(req());

      expect(result.items).toEqual([]);
      expect(result.nextCursor).toBeNull();
    });
  });

  describe('getPlanDetail', () => {
    it('returns {plan, legs} aggregated from two upstream calls', async () => {
      upstream.getJson
        .mockResolvedValueOnce({ status: 200, json: { id: 'p1', state: 'armed' } })
        .mockResolvedValueOnce({ status: 200, json: [{ legId: 'l1' }] });

      const result = await controller.getPlanDetail(
        req('c'),
        '11111111-1111-4111-8111-111111111111',
      );

      expect(result).toEqual({
        plan: { id: 'p1', state: 'armed' },
        legs: [{ legId: 'l1' }],
      });
      expect(upstream.getJson).toHaveBeenCalledTimes(2);
    });

    it('throws HttpException when the plan fetch fails (>=400)', async () => {
      upstream.getJson
        .mockResolvedValueOnce({ status: 404, json: 'not found' })
        .mockResolvedValueOnce({ status: 200, json: [] });

      await expect(
        controller.getPlanDetail(req(), '11111111-1111-4111-8111-111111111111'),
      ).rejects.toThrow(HttpException);
    });

    it('throws HttpException when the legs fetch fails (>=400)', async () => {
      upstream.getJson
        .mockResolvedValueOnce({ status: 200, json: { id: 'p1' } })
        .mockResolvedValueOnce({ status: 500, json: { err: 1 } });

      await expect(
        controller.getPlanDetail(req(), '11111111-1111-4111-8111-111111111111'),
      ).rejects.toThrow(HttpException);
    });

    it('rejects a non-UUID plan id (ParseUUIDPipe)', async () => {
      await expect(controller.getPlanDetail(req(), 'not-a-uuid')).rejects.toThrow();
    });
  });

  describe('positions / incidents / dashboardSummary / approvalsQueue', () => {
    it('positions proxies portfolio /positions json', async () => {
      upstream.getJson.mockResolvedValue({
        status: 200,
        json: [{ instrumentKey: 'BTC' }],
      });

      const result = await controller.positions(req('c'));

      expect(result).toEqual([{ instrumentKey: 'BTC' }]);
      expect(upstream.getJson).toHaveBeenCalledWith(
        expect.stringContaining('/positions'),
        'c',
      );
    });

    it('positions throws HttpException on upstream >=400', async () => {
      upstream.getJson.mockResolvedValue({ status: 500, json: 'err' });
      await expect(controller.positions(req())).rejects.toThrow(HttpException);
    });

    it('incidents proxies reconciliation /mismatches json', async () => {
      upstream.getJson.mockResolvedValue({ status: 200, json: { mismatches: [] } });

      const result = await controller.incidents(req());

      expect(result).toEqual({ mismatches: [] });
      expect(upstream.getJson).toHaveBeenCalledWith(
        expect.stringContaining('/mismatches'),
        undefined,
      );
    });

    it('incidents throws HttpException on upstream >=400', async () => {
      upstream.getJson.mockResolvedValue({ status: 502, json: { e: 1 } });
      await expect(controller.incidents(req())).rejects.toThrow(HttpException);
    });

    it('dashboardSummary proxies operator-web-bff summary', async () => {
      upstream.getJson.mockResolvedValue({
        status: 200,
        json: { capital: { usd: 100 } },
      });

      const result = await controller.dashboardSummary(req());

      expect(result).toEqual({ capital: { usd: 100 } });
      expect(upstream.getJson).toHaveBeenCalledWith(
        expect.stringContaining('/api/operator/dashboard/summary'),
        undefined,
      );
    });

    it('dashboardSummary throws HttpException on upstream >=400', async () => {
      upstream.getJson.mockResolvedValue({ status: 500, json: 'x' });
      await expect(controller.dashboardSummary(req())).rejects.toThrow(HttpException);
    });

    it('approvalsQueue proxies audit /entries with clamped limit (default 50)', async () => {
      upstream.getJson.mockResolvedValue({ status: 200, json: { entries: [] } });

      await controller.approvalsQueue(req());

      expect(upstream.getJson).toHaveBeenCalledWith(
        expect.stringContaining('/audit/entries?limit=50'),
        undefined,
      );
    });

    it('approvalsQueue clamps explicit limit to [1, 200]', async () => {
      upstream.getJson.mockResolvedValue({ status: 200, json: {} });

      await controller.approvalsQueue(req(), '5000');
      expect(upstream.getJson.mock.calls[0]![0]).toMatch(/limit=200$/);

      await controller.approvalsQueue(req(), '0');
      // Number.parseInt('0')||50 -> 0 is falsy -> 50
      expect(upstream.getJson.mock.calls[1]![0]).toMatch(/limit=50$/);
    });

    it('approvalsQueue throws HttpException on upstream >=400', async () => {
      upstream.getJson.mockResolvedValue({ status: 403, json: 'forbidden' });
      await expect(controller.approvalsQueue(req())).rejects.toThrow(HttpException);
    });
  });

  describe('getIncidentBriefs / sessions / safeModeStatus', () => {
    it('getIncidentBriefs delegates to IncidentBriefsService with correlation id', async () => {
      incidentBriefs.buildBriefs.mockResolvedValue([{ id: 'b1' }]);

      const result = await controller.getIncidentBriefs(req('c9'));

      expect(result).toEqual([{ id: 'b1' }]);
      expect(incidentBriefs.buildBriefs).toHaveBeenCalledWith('c9');
    });

    it('sessions returns a placeholder empty list with a guidance note', () => {
      const result = controller.sessions();

      expect(result.items).toEqual([]);
      expect(result.note).toMatch(/audit approvals-queue/);
    });

    it('safeModeStatus wraps SafeModeService.getState()', async () => {
      safeMode.getState.mockResolvedValue({ enabled: true, reason: 'drill' });

      const result = await controller.safeModeStatus();

      expect(result).toEqual({ safeMode: { enabled: true, reason: 'drill' } });
    });
  });
});
