/**
 * Sum two non-negative decimal strings (no exponent) without floating-point loss.
 * Suitable for fill quantity accumulators validated as decimal strings.
 */
export function addNonNegativeDecimalStrings(a: string, b: string): string {
  const normalize = (raw: string): string => {
    const s = raw.trim().replace(/^\+/, '');
    if (!/^\d+(\.\d+)?$/.test(s)) {
      throw new Error(`Invalid non-negative decimal string: "${raw}"`);
    }
    return s;
  };

  const A = normalize(a);
  const B = normalize(b);
  const [ai, af = ''] = A.split('.');
  const [bi, bf = ''] = B.split('.');
  const scale = Math.max(af.length, bf.length);
  const aDigits = `${ai}${af.padEnd(scale, '0')}`;
  const bDigits = `${bi}${bf.padEnd(scale, '0')}`;
  const sum = BigInt(aDigits) + BigInt(bDigits);
  return formatScaledUnsignedInteger(sum, scale);
}

function formatScaledUnsignedInteger(sum: bigint, scale: number): string {
  if (scale === 0) {
    return sum.toString();
  }
  let digits = sum.toString();
  while (digits.length <= scale) {
    digits = `0${digits}`;
  }
  const intPart = digits.slice(0, digits.length - scale);
  const fracPart = digits.slice(digits.length - scale);
  const trimmedFrac = fracPart.replace(/0+$/, '');
  return trimmedFrac.length > 0 ? `${intPart}.${trimmedFrac}` : intPart;
}
