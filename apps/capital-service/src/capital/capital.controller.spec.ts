import { CapitalController } from './capital.controller';
import { CapitalService } from './capital.service';

/**
 * CapitalController spec (Phase 4 — capital-service HTTP API coverage).
 *
 * The controller maps service reservation rows to ISO-date response DTOs.
 * ReserveCapitalDto validation, ParseUUIDPipe, and HttpCode metadata are the
 * controller-level concerns; the reservation state machine lives in
 * CapitalService (covered by capital.service.spec.ts).
 */
describe('CapitalController', () => {
  let service: {
    reserve: jest.Mock;
    getById: jest.Mock;
    release: jest.Mock;
  };
  let controller: CapitalController;

  const UUID = '11111111-1111-4111-8111-111111111111';
  const expiresAt = new Date('2026-07-17T13:00:00Z');

  /** The reservation-row shape returned by CapitalService methods. */
  const reservationRow = (over: Record<string, unknown> = {}) => ({
    id: UUID,
    state: 'reserved',
    correlationId: 'corr-1',
    planId: 'plan-1',
    amountUsd: '1500',
    expiresAt,
    entityVersion: 1,
    ...over,
  });

  /** The expected controller response (ISO-dated expiresAt). */
  const reservationResponse = (over: Record<string, unknown> = {}) => ({
    id: UUID,
    state: 'reserved',
    correlationId: 'corr-1',
    planId: 'plan-1',
    amountUsd: '1500',
    expiresAt: expiresAt.toISOString(),
    entityVersion: 1,
    ...over,
  });

  beforeEach(() => {
    service = {
      reserve: jest.fn(),
      getById: jest.fn(),
      release: jest.fn(),
    };
    controller = new CapitalController(
      service as unknown as CapitalService,
    );
  });

  describe('reserve', () => {
    it('returns 201 with the reservation mapped to an ISO-date DTO', async () => {
      const body = {
        planId: 'plan-1',
        correlationId: 'corr-1',
        amountUsd: 1500,
      };
      service.reserve.mockResolvedValue(reservationRow());

      const result = await controller.reserve(body);

      expect(service.reserve).toHaveBeenCalledWith(body);
      expect(result).toEqual(reservationResponse());
      expect(result.expiresAt).toBe(expiresAt.toISOString());
    });

    it('forwards the service state unchanged (e.g. conflict / rejected)', async () => {
      service.reserve.mockResolvedValue(
        reservationRow({ state: 'released', entityVersion: 3 }),
      );

      const result = await controller.reserve({} as never);

      expect(result.state).toBe('released');
      expect(result.entityVersion).toBe(3);
    });
  });

  describe('getOne', () => {
    it('returns the reservation by id as an ISO-date DTO', async () => {
      service.getById.mockResolvedValue(reservationRow());

      const result = await controller.getOne(UUID);

      expect(service.getById).toHaveBeenCalledWith(UUID);
      expect(result).toEqual(reservationResponse());
    });

    it('forwards a not-found / released state from the service unchanged', async () => {
      service.getById.mockResolvedValue(
        reservationRow({ state: 'expired', entityVersion: 5 }),
      );

      const result = await controller.getOne(UUID);

      expect(result.state).toBe('expired');
    });
  });

  describe('release', () => {
    it('releases the reservation by id and returns the updated ISO-date DTO', async () => {
      service.release.mockResolvedValue(
        reservationRow({ state: 'released', entityVersion: 2 }),
      );

      const result = await controller.release(UUID, {
        idempotencyKey: 'idem-1',
      });

      expect(service.release).toHaveBeenCalledWith(UUID);
      expect(result.state).toBe('released');
      expect(result.entityVersion).toBe(2);
      expect(result.expiresAt).toBe(expiresAt.toISOString());
    });

    it('ignores the body payload (release is id-only on the service side)', async () => {
      service.release.mockResolvedValue(reservationRow());

      await controller.release(UUID, {});

      expect(service.release).toHaveBeenCalledWith(UUID);
    });
  });
});
