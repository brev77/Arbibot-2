import { materializeCapitalReservationExpiryIfNeeded } from './capital-reservation-expiry';
import type { CapitalReservationEntity } from './capital-reservation.entity';

function row(partial: Partial<CapitalReservationEntity>): CapitalReservationEntity {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    planId: null,
    correlationId: 'c1',
    amountUsd: '1',
    state: 'active',
    expiresAt: new Date('2026-01-01T00:00:00.000Z'),
    entityVersion: 1,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    ...partial,
  };
}

describe('materializeCapitalReservationExpiryIfNeeded', () => {
  it('returns false when not active', () => {
    const r = row({ state: 'released' });
    expect(
      materializeCapitalReservationExpiryIfNeeded(
        r,
        new Date('2026-06-01T00:00:00.000Z'),
      ),
    ).toBe(false);
    expect(r.state).toBe('released');
    expect(r.entityVersion).toBe(1);
  });

  it('returns false when active but not yet expired', () => {
    const r = row({
      expiresAt: new Date('2026-06-01T00:00:00.000Z'),
    });
    expect(
      materializeCapitalReservationExpiryIfNeeded(
        r,
        new Date('2026-01-01T00:00:00.000Z'),
      ),
    ).toBe(false);
    expect(r.state).toBe('active');
  });

  it('transitions to expired and bumps version', () => {
    const r = row({
      expiresAt: new Date('2026-01-01T00:00:00.000Z'),
      entityVersion: 3,
    });
    expect(
      materializeCapitalReservationExpiryIfNeeded(
        r,
        new Date('2026-01-01T00:00:01.000Z'),
      ),
    ).toBe(true);
    expect(r.state).toBe('expired');
    expect(r.entityVersion).toBe(4);
  });
});
