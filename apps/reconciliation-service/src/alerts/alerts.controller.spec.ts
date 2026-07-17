import { AlertsController } from './alerts.controller';
import { AlertIncidentsService } from './alert-incidents.service';
import type { AlertmanagerAlertDto } from './dto/alertmanager-webhook.dto';

/** Build a minimal valid AlertmanagerAlertDto (all required fields present). */
const mkAlert = (fingerprint: string): AlertmanagerAlertDto => ({
  status: 'firing',
  labels: { alertname: 'TestAlert', severity: 'warning' },
  annotations: { summary: 'x' },
  startsAt: '2026-07-17T10:00:00Z',
  endsAt: '0001-01-01T00:00:00Z',
  fingerprint,
});

/**
 * AlertsController spec (Phase 4 — reconciliation alerts API coverage).
 *
 * The controller is a thin HTTP adapter over AlertIncidentsService; the only
 * non-trivial logic is the webhook batch counter (inserted vs updated vs
 * null-id skipped). Service is stubbed.
 */
describe('AlertsController', () => {
  let service: {
    ingestAlert: jest.Mock;
    list: jest.Mock;
    setStatus: jest.Mock;
  };
  let controller: AlertsController;

  beforeEach(() => {
    service = {
      ingestAlert: jest.fn(),
      list: jest.fn(),
      setStatus: jest.fn(),
    };
    controller = new AlertsController(
      service as unknown as AlertIncidentsService,
    );
  });

  describe('webhook', () => {
    it('counts inserted vs updated across the alert batch', async () => {
      service.ingestAlert
        .mockResolvedValueOnce({ inserted: true, fingerprint: 'fp-1', id: 'i-1' })
        .mockResolvedValueOnce({ inserted: false, fingerprint: 'fp-2', id: 'i-2' })
        .mockResolvedValueOnce({ inserted: true, fingerprint: 'fp-3', id: 'i-3' });

      const result = await controller.webhook({
        alerts: [mkAlert('fp-1'), mkAlert('fp-2'), mkAlert('fp-3')],
      });

      expect(result).toEqual({ received: 3, inserted: 2, updated: 1 });
      expect(service.ingestAlert).toHaveBeenCalledTimes(3);
    });

    it('skips the updated counter when result.id is null (not inserted, no existing row)', async () => {
      service.ingestAlert.mockResolvedValue({
        inserted: false,
        fingerprint: 'fp-x',
        id: null,
      });

      const result = await controller.webhook({ alerts: [mkAlert('fp-x')] });

      // inserted=false and id=null -> neither inserted nor updated.
      expect(result).toEqual({ received: 1, inserted: 0, updated: 0 });
    });

    it('returns received=0 when alerts array is undefined', async () => {
      // Runtime clients can omit `alerts`; the DTO marks it required but the
      // controller reads `dto.alerts ?? []`, so emulate the absent field.
      const result = await controller.webhook(
        {} as Parameters<typeof controller.webhook>[0],
      );
      expect(result).toEqual({ received: 0, inserted: 0, updated: 0 });
      expect(service.ingestAlert).not.toHaveBeenCalled();
    });

    it('returns received=0 when alerts array is empty', async () => {
      const result = await controller.webhook({ alerts: [] });
      expect(result).toEqual({ received: 0, inserted: 0, updated: 0 });
    });
  });

  describe('list / listIncidents', () => {
    it('list wraps service.list(items) and forwards the status filter', async () => {
      const items = [{ id: 'i-1' }];
      service.list.mockResolvedValue(items);

      const result = await controller.list('firing');

      expect(result).toEqual({ items });
      expect(service.list).toHaveBeenCalledWith('firing');
    });

    it('list forwards undefined status when no query is provided', async () => {
      service.list.mockResolvedValue([]);
      await controller.list(undefined);
      expect(service.list).toHaveBeenCalledWith(undefined);
    });

    it('listIncidents returns the same shape as list (UI /incidents endpoint)', async () => {
      const items = [{ id: 'i-1' }, { id: 'i-2' }];
      service.list.mockResolvedValue(items);

      const result = await controller.listIncidents('open');

      expect(result).toEqual({ items });
      expect(service.list).toHaveBeenCalledWith('open');
    });
  });

  describe('ingest', () => {
    it('delegates a single alert to ingestAlert and returns its result', async () => {
      const ingestResult = {
        inserted: true,
        fingerprint: 'fp-9',
        id: 'i-9',
      };
      service.ingestAlert.mockResolvedValue(ingestResult);

      const result = await controller.ingest(mkAlert('fp-9'));

      expect(result).toBe(ingestResult);
      expect(service.ingestAlert).toHaveBeenCalledWith(mkAlert('fp-9'));
    });
  });

  describe('updateIncidentStatus', () => {
    it('maps dto -> service.setStatus payload (resolvedBy passed through)', async () => {
      const updated = { id: 'i-1', entityVersion: 2 };
      service.setStatus.mockResolvedValue(updated);

      const result = await controller.updateIncidentStatus('i-1', {
        status: 'resolved',
        expectedEntityVersion: 1,
        resolvedBy: 'op-1',
      });

      expect(result).toBe(updated);
      expect(service.setStatus).toHaveBeenCalledWith({
        id: 'i-1',
        status: 'resolved',
        expectedEntityVersion: 1,
        resolvedBy: 'op-1',
      });
    });

    it('defaults resolvedBy to null when dto omits it', async () => {
      service.setStatus.mockResolvedValue({ id: 'i-1' });

      await controller.updateIncidentStatus('i-1', {
        status: 'investigating',
        expectedEntityVersion: 3,
      });

      expect(service.setStatus).toHaveBeenCalledWith(
        expect.objectContaining({ resolvedBy: null }),
      );
    });
  });
});
