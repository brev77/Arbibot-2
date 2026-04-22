import { describe, expect, it } from 'vitest';

import {
  intakeThrottlingSchema,
  validateConfigJson,
} from '@/lib/policy-config-registry';

describe('policy-config-registry', () => {
  it('validates intake.throttling', () => {
    const r = intakeThrottlingSchema.safeParse({
      warmSampleIntervalMs: 5000,
      minRouteScore: 0.2,
    });
    expect(r.success).toBe(true);
  });

  it('rejects intake.throttling with out-of-range score', () => {
    const r = intakeThrottlingSchema.safeParse({ minRouteScore: 2 });
    expect(r.success).toBe(false);
  });

  it('validateConfigJson normalizes known keys', () => {
    const r = validateConfigJson(
      'intake.throttling',
      '{"warmSampleIntervalMs":7000}',
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.normalized).toBe('{"warmSampleIntervalMs":7000}');
    }
  });

  it('validateConfigJson allows unknown keys as opaque JSON', () => {
    const r = validateConfigJson('custom.experimental', '{"a":1}');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.normalized).toBe('{"a":1}');
    }
  });
});
