import { Injectable, type LoggerService } from '@nestjs/common';
import pino, { type Logger, type LoggerOptions, type DestinationStream } from 'pino';

import { getCorrelationId } from '../correlation';
import {
  ARBIBOT_LOG_REDACT_PATHS,
  ARBIBOT_REDACT_CENSOR,
} from './redact.config';

/**
 * Mapping from Nest's log-level method names to pino level numbers.
 * Nest calls: log / error / warn / debug / verbose / fatal.
 * Pino levels: trace=10, debug=20, info=30, warn=40, error=50, fatal=60.
 *
 * `verbose` has no direct pino equivalent — map it to `debug` (Nest's own ConsoleLogger
 * does the same). `fatal` maps to pino's `fatal` (60).
 */
const NEST_METHOD_TO_LEVEL: Record<
  'log' | 'error' | 'warn' | 'debug' | 'verbose' | 'fatal',
  pino.Level
> = {
  log: 'info',
  error: 'error',
  warn: 'warn',
  debug: 'debug',
  verbose: 'debug',
  fatal: 'fatal',
};

/** ENV-resolved minimum log level (anything below is dropped). Default 'info'. */
function resolveLogLevel(): pino.LevelWithSilent {
  const raw = (process.env.LOG_LEVEL ?? 'info').toLowerCase();
  const allowed: ReadonlyArray<pino.LevelWithSilent> = [
    'fatal',
    'error',
    'warn',
    'info',
    'debug',
    'trace',
    'silent',
  ];
  return (allowed as readonly string[]).includes(raw)
    ? (raw as pino.LevelWithSilent)
    : 'info';
}

export interface PinoLoggerServiceOptions {
  /** Service name emitted on every line as `service`. */
  readonly serviceName: string;
  /**
   * `true` (default in non-production) → pino-pretty colourised text for humans.
   * `false` (default in production) → NDJSON one-object-per-line for Loki/Promtail.
   * Override via `ARBIBOT_LOG_PRETTY=true|false`.
   */
  readonly pretty?: boolean;
  /** Override pino options (merged over the defaults). */
  readonly pinoOptions?: LoggerOptions;
  /**
   * Optional destination stream (defaults to stdout). Mainly for tests; production
   * leaves it unset so pino writes to process.stdout for container log capture.
   */
  readonly stream?: DestinationStream;
}

/**
 * NestJS `LoggerService` backed by pino (D4-C-1-LOGGING).
 *
 * Design goals (see `docs/adr-observability-logging-release.md`):
 *   - Emit NDJSON in production, pretty text in dev — so Promtail's existing `json`
 *     pipeline stage (`infra/promtail/promtail-config.yaml`) finally has JSON to parse.
 *   - Read the **existing** ALS correlation id (`getCorrelationId()`) on every emit —
 *     no new middleware, reuses `correlationIdPreHandler`.
 *   - Redact sensitive object-property paths at serialisation (K1.1/K1.2).
 *   - Preserve the Nest `LoggerService` API so the ~104 existing `this.logger.log(...)`
 *     call sites keep working unchanged.
 *
 * Usage in a service `main.ts`:
 * ```ts
 * app.useLogger(new PinoLoggerService({ serviceName: 'risk-service' }));
 * ```
 * Or via the shared helper `configureArbibotLogger(app, serviceName)`.
 */
@Injectable()
export class PinoLoggerService implements LoggerService {
  private readonly logger: Logger;
  readonly serviceName: string;

  constructor(opts: PinoLoggerServiceOptions) {
    this.serviceName = opts.serviceName;
    const usePretty =
      opts.pretty ??
      (process.env.ARBIBOT_LOG_PRETTY === 'true' ||
        process.env.NODE_ENV !== 'production');

    const baseOptions: LoggerOptions = {
      name: opts.serviceName,
      level: resolveLogLevel(),
      // Base context applied to every line.
      base: { service: opts.serviceName },
      // ISO-8601 string in the `time` field — Promtail's `json` stage extracts it
      // and the `timestamp` stage parses it as RFC3339. (Pino's default is epoch
      // millis number; we override for human-readable + Loki compatibility.)
      timestamp: () => `,"time":"${new Date().toISOString()}"`,
      // Redact sensitive paths BEFORE serialisation.
      redact: {
        paths: [...ARBIBOT_LOG_REDACT_PATHS],
        censor: ARBIBOT_REDACT_CENSOR,
      },
      // Attach correlationId from ALS on every emit (no per-call work in app code).
      mixin: () => {
        const correlationId = getCorrelationId();
        return correlationId !== undefined && correlationId.length > 0
          ? { correlationId }
          : {};
      },
      // Stringify message via pino's safe serializer (handles circular refs).
      messageKey: 'msg',
      // Nest's `Logger.log(msg, context)` often passes context as the last arg;
      // we capture it as a field below. crlf is irrelevant for NDJSON.
      formatters: {
        level(label: string): Record<string, unknown> {
          // Emit `level: 'info'` (string label) instead of `level: 30` so Loki can
          // label-filter without a Promtail template stage.
          return { level: label };
        },
      },
    };

    const finalOptions: LoggerOptions = {
      ...baseOptions,
      ...(opts.pinoOptions ?? {}),
    };

    if (usePretty) {
      // pino-pretty is bundled with pino (transport target). Dev-only; production
      // uses the default NDJSON destination for Loki ingestion. When a custom
      // stream is provided (tests), we cannot combine it with a transport target
      // — fall through to NDJSON on that stream so tests still capture JSON.
      this.logger =
        opts.stream !== undefined
          ? pino(finalOptions, opts.stream)
          : pino({
              ...finalOptions,
              transport: {
                target: 'pino-pretty',
                options: {
                  colorize: true,
                  translateTime: 'HH:MM:ss.l',
                  ignore: 'pid,hostname',
                  singleLine: false,
                },
              },
            });
    } else {
      this.logger =
        opts.stream !== undefined
          ? pino(finalOptions, opts.stream)
          : pino(finalOptions);
    }
  }

  // ----- Nest LoggerService implementation ---------------------------------

  log(message: unknown, ...optionalParams: unknown[]): void {
    this.emit('log', message, optionalParams);
  }

  error(message: unknown, ...optionalParams: unknown[]): void {
    this.emit('error', message, optionalParams);
  }

  warn(message: unknown, ...optionalParams: unknown[]): void {
    this.emit('warn', message, optionalParams);
  }

  debug(message: unknown, ...optionalParams: unknown[]): void {
    this.emit('debug', message, optionalParams);
  }

  verbose(message: unknown, ...optionalParams: unknown[]): void {
    this.emit('verbose', message, optionalParams);
  }

  fatal(message: unknown, ...optionalParams: unknown[]): void {
    this.emit('fatal', message, optionalParams);
  }

  /**
   * Core emit. Unpacks Nest's optional-params convention:
   *   - Last string arg = Nest `context` (class name) → emitted as `context` field.
   *   - If only one non-string arg, merge as the pino merge-object.
   *   - If an Error is present, emit as pino `err` (pino's error serializer).
   */
  private emit(
    method: keyof typeof NEST_METHOD_TO_LEVEL,
    message: unknown,
    optionalParams: unknown[],
  ): void {
    const level = NEST_METHOD_TO_LEVEL[method];
    const mergeObj: Record<string, unknown> = {};
    let context: string | undefined;
    let errorObj: Error | undefined;

    for (const arg of optionalParams) {
      if (errorObj === undefined && arg instanceof Error) {
        errorObj = arg;
        continue;
      }
      if (typeof arg === 'string' && context === undefined) {
        // Nest convention: trailing string is the context/class name.
        context = arg;
        continue;
      }
      if (arg !== null && typeof arg === 'object') {
        Object.assign(mergeObj, arg);
      } else if (arg !== undefined) {
        // Primitives get appended to the message via pino's `%s`-style merging;
        // we stringify them into the message instead.
        mergeObj.__extra ??= [];
        (mergeObj.__extra as unknown[]).push(arg);
      }
    }

    if (context !== undefined) {
      mergeObj.context = context;
    }
    if (errorObj !== undefined) {
      mergeObj.err = errorObj;
    }

    // pino merges the first object argument into the line; the second is the message.
    if (message instanceof Error && errorObj === undefined) {
      mergeObj.err = message;
      this.logger[level](mergeObj);
    } else if (
      message !== null &&
      typeof message === 'object' &&
      !Array.isArray(message)
    ) {
      Object.assign(mergeObj, message);
      this.logger[level](mergeObj);
    } else {
      this.logger[level](mergeObj, String(message));
    }
  }

  /** Test/utility: the underlying pino logger. */
  get pinoLogger(): Logger {
    return this.logger;
  }
}
