import { materializeRiskWindowReservationExpiryIfNeeded } from './risk-window-reservation-expiry';
import type { RiskWindowReservationEntity } from './risk-window-reservation.entity';

describe('materializeRiskWindowReservationExpiryIfNeeded', () => {
  it('returns false when still reserved and not expired', () => {
    const row = {
      state: 'reserved',
      expiresAt: new Date(Date.now() + 60_000),
      entityVersion: 1,
    } as RiskWindowReservationEntity;
    expect(
      materializeRiskWindowReservationExpiryIfNeeded(row, new Date()),
    ).toBe(false);
    expect(row.state).toBe('reserved');
  });

  it('transitions to expired when past expires_at', () => {
    const row = {
      state: 'reserved',
      expiresAt: new Date(0),
      entityVersion: 1,
    } as RiskWindowReservationEntity;
    expect(
      materializeRiskWindowReservationExpiryIfNeeded(row, new Date()),
    ).toBe(true);
    expect(row.state).toBe('expired');
    expect(row.entityVersion).toBe(2);
  });
});
