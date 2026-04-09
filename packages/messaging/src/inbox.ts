import { QueryFailedError, type EntityManager } from 'typeorm';

import { InboxEventEntity } from '@arbibot/persistence';

/**
 * Returns true if this consumer has not yet processed messageId (insert succeeded).
 * Duplicate delivery → unique violation → false (idempotent skip).
 */
export async function tryClaimInboxMessage(
  em: EntityManager,
  consumerId: string,
  messageId: string,
  payloadHash?: string,
): Promise<boolean> {
  const row = em.create(InboxEventEntity, {
    consumerId,
    messageId,
    payloadHash: payloadHash ?? null,
    processedAt: null,
  });
  try {
    await em.save(InboxEventEntity, row);
    return true;
  } catch (e: unknown) {
    if (isPgUniqueViolation(e)) {
      return false;
    }
    throw e;
  }
}

function isPgUniqueViolation(error: unknown): boolean {
  if (
    error instanceof QueryFailedError &&
    typeof error.driverError === 'object' &&
    error.driverError !== null &&
    (error.driverError as { code?: string }).code === '23505'
  ) {
    return true;
  }
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === '23505'
  );
}
