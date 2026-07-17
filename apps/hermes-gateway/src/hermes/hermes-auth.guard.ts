import { timingSafeEqual } from 'node:crypto';

import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';

const HEADER = 'x-hermes-api-key';

function parseAllowedKeys(): string[] {
  const raw = process.env.HERMES_API_KEYS;
  if (raw === undefined || raw.trim().length === 0) {
    return [];
  }
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Constant-time key comparison (H2, timing-attack hardening).
 *
 * `Array.includes` / `===` short-circuit on the first non-matching character,
 * leaking the matching prefix length through response timing and enabling a
 * byte-by-byte key-recovery side-channel. `crypto.timingSafeEqual` is
 * constant-time but throws on mismatched Buffer lengths — which would itself
 * leak the key length. To avoid both leaks we:
 *   1. Track a running match flag across every allowed key (no early exit).
 *   2. For each key, run `timingSafeEqual` against a same-length stand-in
 *      (the key itself) whenever the provided value's length differs, so the
 *      timing depends only on the number of allowed keys, never on where the
 *      mismatch is.
 */
function safeKeyEquals(provided: string, allowed: string[]): boolean {
  const providedBuf = Buffer.from(provided);
  let matched = false;
  for (const key of allowed) {
    const keyBuf = Buffer.from(key);
    if (keyBuf.length === providedBuf.length) {
      if (timingSafeEqual(providedBuf, keyBuf)) {
        matched = true;
        // Do NOT break: keep iterating to hold timing constant w.r.t. the
        // position of the match within the allowed list.
      }
    } else {
      // Lengths differ — timingSafeEqual would throw. Run a dummy comparison
      // against the key itself to spend comparable time without leaking the
      // provided value's length via an early return.
      timingSafeEqual(keyBuf, keyBuf);
    }
  }
  return matched;
}

@Injectable()
export class HermesAuthGuard implements CanActivate {
  private readonly log = new Logger(HermesAuthGuard.name);

  canActivate(context: ExecutionContext): boolean {
    const allowed = parseAllowedKeys();
    if (allowed.length === 0) {
      this.log.warn('HERMES_API_KEYS is empty — rejecting Hermes requests');
      throw new UnauthorizedException(
        'Hermes API is not configured (HERMES_API_KEYS)',
      );
    }

    const req = context.switchToHttp().getRequest<{
      headers: Record<string, string | string[] | undefined>;
    }>();
    const headerVal = req.headers[HEADER];
    const provided =
      typeof headerVal === 'string'
        ? headerVal
        : Array.isArray(headerVal)
          ? headerVal[0]
          : '';

    if (provided === undefined || provided.length === 0) {
      this.log.warn('Missing x-hermes-api-key');
      throw new UnauthorizedException('Missing x-hermes-api-key header');
    }

    if (!safeKeyEquals(provided, allowed)) {
      this.log.warn('Invalid x-hermes-api-key (rejected)');
      throw new UnauthorizedException('Invalid x-hermes-api-key');
    }

    return true;
  }
}
