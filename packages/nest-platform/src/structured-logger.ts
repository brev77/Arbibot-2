import type { LoggerService } from '@nestjs/common';

import { getCorrelationId } from './correlation';

/**
 * Wrap a Nest `LoggerService` so each call prepends the ALS correlation id
 * (D4-C-1-LOGGING: legacy shim; new code should use `PinoLoggerService`, which
 * emits structured JSON with `correlationId` as a field — no prefix needed).
 *
 * API preserved for backward compatibility. The wrapper is correlation-aware
 * regardless of the underlying logger: if the base is the default Nest console
 * logger, the prefix keeps logs traceable until that service switches to pino.
 * Once a service uses `configureArbibotLogger`, `correlationId` is already a
 * structured field and this wrapper becomes a no-op pass-through.
 */
export function withCorrelation(base: LoggerService): LoggerService {
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
