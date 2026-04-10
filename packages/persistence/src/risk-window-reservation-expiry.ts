import type { RiskWindowReservationEntity } from './risk-window-reservation.entity';

/** Lazy transition reserved → expired when past expires_at. Returns true if mutated. */
export function materializeRiskWindowReservationExpiryIfNeeded(
  row: RiskWindowReservationEntity,
  now: Date,
): boolean {
  if (row.state !== 'reserved') {
    return false;
  }
  if (row.expiresAt.getTime() > now.getTime()) {
    return false;
  }
  row.state = 'expired';
  row.entityVersion += 1;
  return true;
}
