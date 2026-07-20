import { asExceptionBody } from './http-error';

/**
 * asExceptionBody spec (Plan 6 — http-error helper coverage).
 *
 * The helper normalizes an upstream response body into a shape that can be
 * serialized as an HttpException response. We exercise every branch:
 *   - string → pass through
 *   - array → pass through
 *   - object (non-null) → cast to Record
 *   - null / undefined / number / boolean / bigint → stringify
 */
describe('asExceptionBody', () => {
  it('passes string bodies through verbatim', () => {
    expect(asExceptionBody('bad request')).toBe('bad request');
  });

  it('passes empty string through verbatim', () => {
    expect(asExceptionBody('')).toBe('');
  });

  it('passes array bodies through verbatim', () => {
    const arr = ['err1', 'err2'];
    expect(asExceptionBody(arr)).toBe(arr);
  });

  it('passes object bodies through (cast to Record)', () => {
    const obj = { message: 'conflict', detail: 'stale version' };
    expect(asExceptionBody(obj)).toBe(obj);
  });

  it('stringifies null to "null"', () => {
    expect(asExceptionBody(null)).toBe('null');
  });

  it('stringifies undefined to "undefined"', () => {
    expect(asExceptionBody(undefined)).toBe('undefined');
  });

  it('stringifies numbers', () => {
    expect(asExceptionBody(42)).toBe('42');
  });

  it('stringifies booleans', () => {
    expect(asExceptionBody(true)).toBe('true');
    expect(asExceptionBody(false)).toBe('false');
  });

  it('stringifies bigint', () => {
    expect(asExceptionBody(0n)).toBe('0');
  });
});
