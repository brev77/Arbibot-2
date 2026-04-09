import type { CapitalReservationEntity } from './capital-reservation.entity';

/**
 * Lazy TTL transition: if still `active` but `expires_at` is in the past,
 * marks the row as `expired` in memory so the caller can `save` within its transaction.
 *
 * @returns true if the entity was mutated and should be persisted.
 */
export function materializeCapitalReservationExpiryIfNeeded(
  row: CapitalReservationEntity,
  now: Date,
): boolean {
  if (row.state !== 'active') {
    return false;
  }
  if (row.expiresAt.getTime() > now.getTime()) {
    return false;
  }
  row.state = 'expired';
  row.entityVersion += 1;
  return true;
}
