import { HttpException, HttpStatus } from '@nestjs/common';

import { HealthController } from './health.controller';

/**
 * HealthController spec (Phase 4 — hermes-gateway health probes coverage).
 *
 * hermes-gateway has no DB by default, so the controller accepts an Optional
 * DataSource that resolves to `undefined`. We exercise both branches:
 *  - no DataSource → ready() degrades to liveness-only 200
 *  - injected DataSource → SELECT 1 ping (ok / failure paths)
 *
 * `GET /health/operator-bff` is env-gated on OPERATOR_WEB_BFF_BASE; we stub
 * global.fetch and assert both the configured/unconfigured and reachable/
 * network-error paths.
 */
describe('HealthController', () => {
  const prevBff = process.env.OPERATOR_WEB_BFF_BASE;
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
    delete process.env.OPERATOR_WEB_BFF_BASE;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    if (prevBff === undefined) {
      delete process.env.OPERATOR_WEB_BFF_BASE;
    } else {
      process.env.OPERATOR_WEB_BFF_BASE = prevBff;
    }
  });

  describe('basic probes', () => {
    it('health returns ok with hermes-gateway identity and phase', () => {
      const c = new HealthController();
      expect(c.health()).toEqual({
        ok: true,
        service: 'hermes-gateway',
        phase: '5-gateway-read',
      });
    });

    it('live returns ok:true (always 200)', () => {
      const c = new HealthController();
      expect(c.live()).toEqual({ ok: true });
    });
  });

  describe('ready', () => {
    it('returns ok with no checks when no DataSource is injected (liveness-only)', async () => {
      const c = new HealthController();
      const report = await c.ready();
      expect(report).toEqual({ ok: true, checks: {} });
    });

    it('reports database ok when SELECT 1 succeeds', async () => {
      const ds = { query: jest.fn().mockResolvedValue([{ '?column?': 1 }]) };
      const c = new HealthController(ds);
      const report = await c.ready();
      expect(report.ok).toBe(true);
      expect(report.checks.database?.ok).toBe(true);
      expect(report.checks.database?.error).toBeUndefined();
      expect(typeof report.checks.database?.latencyMs).toBe('number');
      expect(ds.query).toHaveBeenCalledWith('SELECT 1');
    });

    it('returns 503 with failing check when SELECT 1 throws', async () => {
      const ds = { query: jest.fn().mockRejectedValue(new Error('connection refused')) };
      const c = new HealthController(ds);
      await expect(c.ready()).rejects.toMatchObject({
        status: HttpStatus.SERVICE_UNAVAILABLE,
      });
      try {
        await c.ready();
      } catch (e) {
        const body = (e as HttpException).getResponse() as {
          ok: boolean;
          checks: Record<string, { ok: boolean; error?: string }>;
        };
        expect(body.ok).toBe(false);
        expect(body.checks.database?.ok).toBe(false);
        expect(body.checks.database?.error).toBe('connection refused');
      }
    });

    it('stringifies non-Error throws in the database check', async () => {
      const ds = { query: jest.fn().mockRejectedValue('boom-string') };
      const c = new HealthController(ds);
      await expect(c.ready()).rejects.toMatchObject({
        status: HttpStatus.SERVICE_UNAVAILABLE,
      });
      try {
        await c.ready();
      } catch (e) {
        const body = (e as HttpException).getResponse() as {
          checks: Record<string, { error?: string }>;
        };
        expect(body.checks.database?.error).toBe('boom-string');
      }
    });
  });

  describe('operatorBffProbe', () => {
    it('returns configured:false when OPERATOR_WEB_BFF_BASE is unset', async () => {
      const c = new HealthController();
      const res = await c.operatorBffProbe();
      expect(res).toEqual({ configured: false, reachable: null, status: null });
    });

    it('treats whitespace-only base as configured (length > 0) and reaches BFF', async () => {
      // normalizeBase only strips a trailing slash; whitespace passes the
      // `base.length > 0` guard, so the probe attempts a fetch.
      process.env.OPERATOR_WEB_BFF_BASE = '   ';
      global.fetch = jest.fn().mockRejectedValue(new Error('bad url'));
      const c = new HealthController();
      const res = await c.operatorBffProbe();
      expect(res).toEqual({ configured: true, reachable: false, status: null });
    });

    it('strips trailing slash and reports reachability on 2xx', async () => {
      process.env.OPERATOR_WEB_BFF_BASE = 'http://bff.example/';
      global.fetch = jest
        .fn()
        .mockResolvedValue({ ok: true, status: 200 });
      const c = new HealthController();
      const res = await c.operatorBffProbe();
      expect(res).toEqual({ configured: true, reachable: true, status: 200 });
      expect(global.fetch).toHaveBeenCalledWith(
        'http://bff.example/api/operator/dashboard/summary',
        { method: 'GET' },
      );
    });

    it('reports reachable:false on non-2xx status', async () => {
      process.env.OPERATOR_WEB_BFF_BASE = 'http://bff.example';
      global.fetch = jest
        .fn()
        .mockResolvedValue({ ok: false, status: 503 });
      const c = new HealthController();
      const res = await c.operatorBffProbe();
      expect(res).toEqual({ configured: true, reachable: false, status: 503 });
    });

    it('returns reachable:false with null status on network error', async () => {
      process.env.OPERATOR_WEB_BFF_BASE = 'http://bff.example';
      global.fetch = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'));
      const c = new HealthController();
      const res = await c.operatorBffProbe();
      expect(res).toEqual({ configured: true, reachable: false, status: null });
    });
  });
});
