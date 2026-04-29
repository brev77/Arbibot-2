/**
 * Type-safe Ethereum address type
 * Ensures address is 0x-prefixed and 42 characters long
 */
export type Address = `0x${string}`;

/**
 * Validate Ethereum address format
 */
export function isValidAddress(address: string): address is Address {
  return /^0x[a-fA-F0-9]{40}$/.test(address);
}

/**
 * Assert that an address is valid, throw if not
 */
export function assertValidAddress(address: string): Address {
  if (!isValidAddress(address)) {
    throw new Error(`Invalid Ethereum address: ${address}`);
  }
  return address;
}

/**
 * Normalize address to lowercase
 */
export function normalizeAddress(address: Address): Address {
  return address.toLowerCase() as Address;
}

/**
 * Check if two addresses are the same (case-insensitive)
 */
export function isSameAddress(a: Address, b: Address): boolean {
  return normalizeAddress(a) === normalizeAddress(b);
}

/**
 * Zero address constant
 */
export const ZERO_ADDRESS: Address = '0x0000000000000000000000000000000000000000';

/**
 * Check if address is zero address
 */
export function isZeroAddress(address: Address): boolean {
  return normalizeAddress(address) === ZERO_ADDRESS;
}