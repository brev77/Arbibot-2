import { TokenBucket } from './token-bucket';

describe('TokenBucket', () => {
  describe('constructor', () => {
    it('throws on non-positive rate', () => {
      expect(() => new TokenBucket(0)).toThrow(/ratePerSecond/);
      expect(() => new TokenBucket(-1)).toThrow(/ratePerSecond/);
      expect(() => new TokenBucket(NaN)).toThrow(/ratePerSecond/);
    });

    it('throws on non-positive capacity', () => {
      expect(() => new TokenBucket(10, 0)).toThrow(/capacity/);
      expect(() => new TokenBucket(10, -1)).toThrow(/capacity/);
    });

    it('starts full (capacity tokens available)', () => {
      const bucket = new TokenBucket(10, 5);
      expect(bucket.availableTokens()).toBe(5);
    });

    it('defaults capacity to ratePerSecond', () => {
      const bucket = new TokenBucket(10);
      expect(bucket.availableTokens()).toBe(10);
    });
  });

  describe('tryConsume', () => {
    it('consumes one token by default and returns true', () => {
      const t = 1000;
      const bucket = new TokenBucket(10, 10, () => t);
      expect(bucket.tryConsume()).toBe(true);
      expect(bucket.availableTokens()).toBe(9);
    });

    it('consumes a multi-token cost', () => {
      const t = 1000;
      const bucket = new TokenBucket(10, 10, () => t);
      expect(bucket.tryConsume(3)).toBe(true);
      expect(bucket.availableTokens()).toBe(7);
    });

    it('returns false when not enough tokens (no mutation)', () => {
      const t = 1000;
      const bucket = new TokenBucket(10, 2, () => t);
      expect(bucket.tryConsume(2)).toBe(true); // 2 → 0
      expect(bucket.tryConsume()).toBe(false); // empty
      expect(bucket.availableTokens()).toBe(0); // not mutated
    });
  });

  describe('refill', () => {
    it('refills proportionally to elapsed time', () => {
      let t = 0;
      const bucket = new TokenBucket(10, 10, () => t); // 10 rps, cap 10
      expect(bucket.tryConsume(10)).toBe(true); // drain to 0
      t = 500; // +0.5s → +5 tokens
      expect(bucket.availableTokens()).toBeCloseTo(5, 5);
      expect(bucket.tryConsume(5)).toBe(true);
    });

    it('caps refill at capacity', () => {
      let t = 0;
      const bucket = new TokenBucket(10, 10, () => t);
      expect(bucket.tryConsume(10)).toBe(true); // drain
      t = 10_000; // way past capacity
      expect(bucket.availableTokens()).toBe(10); // capped, not 100
    });

    it('does not refill on zero elapsed time', () => {
      const t = 1000;
      const bucket = new TokenBucket(10, 10, () => t);
      expect(bucket.tryConsume(5)).toBe(true); // 5 left
      expect(bucket.availableTokens()).toBe(5); // no time passed → no refill
    });

    it('handles negative time skew gracefully (no refund)', () => {
      let t = 1000;
      const bucket = new TokenBucket(10, 10, () => t);
      expect(bucket.tryConsume(5)).toBe(true); // 5 left
      t = 500; // clock went backwards
      expect(bucket.availableTokens()).toBe(5); // unchanged
    });
  });

  describe('setRate (runtime tuning)', () => {
    it('updates rate without losing tokens', () => {
      let t = 0;
      const bucket = new TokenBucket(10, 10, () => t);
      expect(bucket.tryConsume(8)).toBe(true); // 2 left
      bucket.setRate(20, 20);
      expect(bucket.availableTokens()).toBe(2); // preserved
      t = 1000; // +1s → +20 tokens, capped at 20
      expect(bucket.availableTokens()).toBe(20);
    });

    it('clamps tokens down if new capacity is lower', () => {
      const t = 0;
      const bucket = new TokenBucket(10, 10, () => t);
      bucket.setRate(5, 3); // capacity shrinks to 3
      expect(bucket.availableTokens()).toBe(3);
    });

    it('throws on invalid rate', () => {
      const bucket = new TokenBucket(10);
      expect(() => bucket.setRate(0)).toThrow(/ratePerSecond/);
      expect(() => bucket.setRate(10, 0)).toThrow(/capacity/);
    });
  });
});
