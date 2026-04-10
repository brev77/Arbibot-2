import type { EntityManager } from 'typeorm';

/** Row from `outbox_events` locked with FOR UPDATE SKIP LOCKED (Postgres). */
export type LockedOutboxRow = {
  readonly id: string;
  readonly messageId: string;
  readonly eventType: string;
  readonly entityType: string;
  readonly entityId: string;
  readonly schemaVersion: number;
  readonly payload: Record<string, unknown>;
  readonly envelope: Record<string, unknown>;
  readonly createdAt: Date;
  readonly processedAt: null;
  readonly relayDeliveryAttempts: number;
};

/**
 * Locks up to `limit` unprocessed outbox rows for this transaction.
 * Use one transaction per tick (or per row) so failures do not block unrelated events.
 */
export async function fetchLockedOutboxBatch(
  em: EntityManager,
  limit: number,
): Promise<LockedOutboxRow[]> {
  const rows: Record<string, unknown>[] = await em.query(
    `
    SELECT id::text AS id,
           message_id AS "messageId",
           event_type AS "eventType",
           entity_type AS "entityType",
           entity_id AS "entityId",
           schema_version AS "schemaVersion",
           payload,
           envelope,
           created_at AS "createdAt",
           processed_at AS "processedAt",
           COALESCE(relay_delivery_attempts, 0) AS "relayDeliveryAttempts"
    FROM outbox_events
    WHERE processed_at IS NULL
      AND relay_dead_letter_at IS NULL
    ORDER BY id ASC
    LIMIT $1
    FOR UPDATE SKIP LOCKED
    `,
    [limit],
  );
  return rows as unknown as LockedOutboxRow[];
}
