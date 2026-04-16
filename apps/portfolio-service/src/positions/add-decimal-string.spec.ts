import { addNonNegativeDecimalStrings } from './add-decimal-string';

describe('addNonNegativeDecimalStrings', () => {
  it('adds integers', () => {
    expect(addNonNegativeDecimalStrings('0', '0')).toBe('0');
    expect(addNonNegativeDecimalStrings('10', '5')).toBe('15');
  });

  it('adds fractional parts without float error', () => {
    expect(addNonNegativeDecimalStrings('0.1', '0.2')).toBe('0.3');
  });

  it('aligns scales', () => {
    expect(addNonNegativeDecimalStrings('1.5', '2')).toBe('3.5');
    expect(addNonNegativeDecimalStrings('0.01', '0.02')).toBe('0.03');
  });

  it('handles large digit strings without Number precision loss', () => {
    const x = '9007199254740993'; // > Number.MAX_SAFE_INTEGER
    expect(addNonNegativeDecimalStrings(x, '1')).toBe('9007199254740994');
  });

  it('rejects invalid input', () => {
    expect(() => addNonNegativeDecimalStrings('1e2', '1')).toThrow();
    expect(() => addNonNegativeDecimalStrings('-1', '1')).toThrow();
  });
});
