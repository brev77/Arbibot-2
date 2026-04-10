/** Extract Kafka message key / inbox id from stored outbox envelope JSON. */
export function messageIdFromEnvelope(
  envelope: Record<string, unknown>,
): string | null {
  const mid = envelope.messageId;
  return typeof mid === 'string' && mid.length > 0 ? mid : null;
}
