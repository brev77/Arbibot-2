import { messageIdFromEnvelope } from './envelope';

describe('messageIdFromEnvelope', () => {
  it('returns messageId when present', () => {
    expect(
      messageIdFromEnvelope({ messageId: '550e8400-e29b-41d4-a716-446655440000' }),
    ).toBe('550e8400-e29b-41d4-a716-446655440000');
  });

  it('returns null when missing or wrong type', () => {
    expect(messageIdFromEnvelope({})).toBeNull();
    expect(messageIdFromEnvelope({ messageId: 1 } as never)).toBeNull();
  });
});
