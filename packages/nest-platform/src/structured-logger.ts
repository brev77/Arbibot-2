import { LoggerService } from '@nestjs/common';

import { getCorrelationId } from './correlation';

/**
 * Wraps Nest LoggerService to append correlationId from ALS when present (P1-1.1-OBS baseline).
 */
export function withCorrelation(
  base: LoggerService,
): LoggerService {
  const prefix = (): string => {
    const c = getCorrelationId();
    return c ? `[correlationId=${c}] ` : '';
  };
  return {
    log: (m, ...o) => base.log(`${prefix()}${m}`, ...o),
    error: (m, ...o) => base.error(`${prefix()}${m}`, ...o),
    warn: (m, ...o) => base.warn(`${prefix()}${m}`, ...o),
    debug: (m, ...o) => base.debug?.(`${prefix()}${m}`, ...o),
    verbose: (m, ...o) => base.verbose?.(`${prefix()}${m}`, ...o),
    fatal: (m, ...o) => base.fatal?.(`${prefix()}${m}`, ...o),
  };
}
