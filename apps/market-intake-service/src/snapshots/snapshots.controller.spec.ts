import { BadRequestException, HttpStatus } from '@nestjs/common';

import { SnapshotsController } from './snapshots.controller';
import { SnapshotsService } from './snapshots.service';

/**
 * SnapshotsController spec (Phase 4 — market-intake-service controller coverage).
 *
 * The controller is a thin HTTP adapter over SnapshotsService with three
 * concerns worth asserting:
 *   - GET /fresh defaults limit=100 and forwards to findFresh
 *   - POST /ingest returns 429 with throttled:true when SnapshotsService
 *     throttles, and otherwise maps result fields + sets the
 *     X-Idempotent-Replayed header on idempotent replays
 *   - GET / requires both venueCode and venueSymbol (else BadRequestException)
 *
 * All collaborators are stubbed.
 */
describe('SnapshotsController', () => {
  let snapshots: {
    findFresh: jest.Mock;
    ingest: jest.Mock;
    getOne: jest.Mock;
  };
  let controller: SnapshotsController;

  beforeEach(() => {
    snapshots = {
      findFresh: jest.fn(),
      ingest: jest.fn(),
      getOne: jest.fn(),
    };
    controller = new SnapshotsController(
      snapshots as unknown as SnapshotsService,
    );
  });

  describe('getFresh', () => {
    it('defaults limit to 100 when dto.limit is undefined', async () => {
      snapshots.findFresh.mockResolvedValue({ items: [], total: 0 });
      await controller.getFresh({});
      expect(snapshots.findFresh).toHaveBeenCalledWith(100);
    });

    it('forwards an explicit limit to findFresh', async () => {
      snapshots.findFresh.mockResolvedValue({ items: [], total: 0 });
      await controller.getFresh({ limit: 25 });
      expect(snapshots.findFresh).toHaveBeenCalledWith(25);
    });

    it('returns the service result verbatim', async () => {
      const payload = {
        items: [{ id: 'snap-1', venueCode: 'BINANCE' }],
        total: 1,
      };
      snapshots.findFresh.mockResolvedValue(payload);
      const out = await controller.getFresh({ limit: 1 });
      expect(out).toBe(payload);
    });
  });

  describe('ingest', () => {
    /** Minimal FastifyReply stub capturing status() and header() calls. */
    const mkRes = () => {
      const calls: {
        status: number[];
        headers: Record<string, string>;
      } = { status: [], headers: {} };
      return {
        calls,
        res: {
          status(code: number) {
            calls.status.push(code);
            return this;
          },
          header(name: string, value: string) {
            calls.headers[name] = value;
            return this;
          },
        },
      };
    };

    it('sets 429 status and returns throttled:true when service throttles', async () => {
      const { res, calls } = mkRes();
      snapshots.ingest.mockResolvedValue({
        throttled: true,
        throttleReason: 'warm_sampling',
      });
      const body = {
        venueCode: 'BINANCE',
        venueSymbol: 'BTCUSDT',
        observedAt: '2026-04-10T12:00:00.000Z',
      };
      const out = await controller.ingest(
        body,
        res as never,
      );
      expect(calls.status).toEqual([HttpStatus.TOO_MANY_REQUESTS]);
      expect(out).toEqual({ throttled: true, reason: 'warm_sampling' });
    });

    it('falls back to generic "throttled" reason when throttleReason is absent', async () => {
      const { res } = mkRes();
      snapshots.ingest.mockResolvedValue({ throttled: true });
      const out = await controller.ingest(
        {
          venueCode: 'BINANCE',
          venueSymbol: 'BTCUSDT',
          observedAt: '2026-04-10T12:00:00.000Z',
        },
        res as never,
      );
      expect(out).toEqual({ throttled: true, reason: 'throttled' });
    });

    it('maps successful ingest result fields verbatim when not throttled', async () => {
      const { res, calls } = mkRes();
      snapshots.ingest.mockResolvedValue({
        snapshotId: 'snap-1',
        outboxMessageId: 'msg-1',
        entityVersion: 2,
        idempotentReplay: false,
        unchanged: false,
      });
      const out = await controller.ingest(
        {
          venueCode: 'BINANCE',
          venueSymbol: 'BTCUSDT',
          observedAt: '2026-04-10T12:00:00.000Z',
        },
        res as never,
      );
      expect(calls.status).toEqual([]);
      expect(out).toEqual({
        snapshotId: 'snap-1',
        outboxMessageId: 'msg-1',
        entityVersion: 2,
        idempotentReplay: false,
        unchanged: false,
      });
    });

    it('sets X-Idempotent-Replayed header when idempotentReplay=true', async () => {
      const { res, calls } = mkRes();
      snapshots.ingest.mockResolvedValue({
        snapshotId: 'snap-1',
        outboxMessageId: 'msg-prev',
        entityVersion: 1,
        idempotentReplay: true,
        unchanged: true,
      });
      await controller.ingest(
        {
          venueCode: 'BINANCE',
          venueSymbol: 'BTCUSDT',
          observedAt: '2026-04-10T12:00:00.000Z',
        },
        res as never,
      );
      expect(calls.headers['X-Idempotent-Replayed']).toBe('true');
    });

    it('does not set X-Idempotent-Replayed header on fresh ingest', async () => {
      const { res, calls } = mkRes();
      snapshots.ingest.mockResolvedValue({
        snapshotId: 'snap-1',
        outboxMessageId: 'msg-1',
        entityVersion: 1,
        idempotentReplay: false,
        unchanged: false,
      });
      await controller.ingest(
        {
          venueCode: 'BINANCE',
          venueSymbol: 'BTCUSDT',
          observedAt: '2026-04-10T12:00:00.000Z',
        },
        res as never,
      );
      expect(calls.headers['X-Idempotent-Replayed']).toBeUndefined();
    });
  });

  describe('get', () => {
    it('throws BadRequestException when both query params are missing', () => {
      // Note: get() throws synchronously (it is not async) when validation fails.
      expect(() => controller.get(undefined, undefined)).toThrow(
        BadRequestException,
      );
    });

    it('throws BadRequestException when venueSymbol is missing', () => {
      expect(() => controller.get('BINANCE', undefined)).toThrow(
        BadRequestException,
      );
    });

    it('throws BadRequestException when venueCode is empty string', () => {
      expect(() => controller.get('', 'BTCUSDT')).toThrow(BadRequestException);
    });

    it('throws BadRequestException when venueCode is whitespace-only', () => {
      expect(() => controller.get('   ', 'BTCUSDT')).toThrow(
        BadRequestException,
      );
    });

    it('throws BadRequestException when venueSymbol is whitespace-only', () => {
      expect(() => controller.get('BINANCE', '   ')).toThrow(
        BadRequestException,
      );
    });

    it('trims whitespace and forwards to getOne when both params are present', async () => {
      snapshots.getOne.mockResolvedValue({ snapshot: { id: 'snap-1' } });
      await controller.get('  BINANCE  ', '  BTCUSDT  ');
      expect(snapshots.getOne).toHaveBeenCalledWith('BINANCE', 'BTCUSDT');
    });

    it('returns the service result verbatim', async () => {
      const payload = { snapshot: { id: 'snap-1' }, freshness: {} };
      snapshots.getOne.mockResolvedValue(payload);
      const out = await controller.get('BINANCE', 'BTCUSDT');
      expect(out).toBe(payload);
    });
  });
});
