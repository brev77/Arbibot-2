import { Writable } from 'node:stream';

import { runWithCorrelationId } from '../correlation';
import {
  PinoLoggerService,
  type PinoLoggerServiceOptions,
} from './pino-logger.service';

/**
 * Capture pino output by injecting an in-memory destination stream. Each call
 * produces one JSON line; we parse them to assert structure / redaction / levels.
 */
type Line = Record<string, unknown>;

function makeCapturingLogger(
  opts: PinoLoggerServiceOptions,
): { svc: PinoLoggerService; lines: () => Line[] } {
  const lines: Line[] = [];
  // pino `destination`-like sink: a writable that pushes JSON-parsed objects.
  const sink = new Writable({
    write(chunk: Buffer, _enc: string, cb: () => void): void {
      const text = chunk.toString('utf8');
      for (const ln of text.split('\n')) {
        if (ln.length === 0) continue;
        try {
          lines.push(JSON.parse(ln) as Line);
        } catch {
          // pretty-mode leaves non-JSON lines; ignore in tests.
        }
      }
      cb();
    },
  });
  const svc = new PinoLoggerService({
    ...opts,
    pretty: false,
    stream: sink,
  });
  return { svc, lines: () => lines };
}

/** First emitted line, as a typed record. Throws if nothing was emitted. */
function firstLine(lines: Line[]): Line {
  const l = lines[0];
  if (l === undefined) {
    throw new Error('no log line emitted');
  }
  return l;
}

describe('PinoLoggerService', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('emits one JSON object per line with the required envelope fields', () => {
    const { svc, lines } = makeCapturingLogger({ serviceName: 'risk-service' });
    svc.log('hello world');
    const line = firstLine(lines());
    expect(line.service).toBe('risk-service');
    expect(line.level).toBe('info');
    expect(line.msg).toBe('hello world');
    // pino default timestamp is an ISO-8601 string (Promtail RFC3339-compatible).
    expect(typeof line.time).toBe('string');
    expect(() => new Date(line.time as string)).not.toThrow();
  });

  it('maps Nest method names to pino levels (string labels)', () => {
    // Force LOG_LEVEL=debug so debug/verbose lines are not filtered out by level.
    process.env.LOG_LEVEL = 'debug';
    const { svc, lines } = makeCapturingLogger({ serviceName: 'svc' });
    svc.warn('w');
    svc.error('e');
    svc.debug('d');
    svc.verbose('v');
    svc.fatal('f');
    const levels = lines().map((l) => l.level);
    expect(levels).toEqual(['warn', 'error', 'debug', 'debug', 'fatal']);
  });

  it('captures the trailing string as Nest `context` field', () => {
    const { svc, lines } = makeCapturingLogger({ serviceName: 'svc' });
    svc.log('starting', 'CapitalService');
    const line = firstLine(lines());
    expect(line.context).toBe('CapitalService');
    expect(line.msg).toBe('starting');
  });

  it('merges an object argument into the line', () => {
    const { svc, lines } = makeCapturingLogger({ serviceName: 'svc' });
    svc.log('reserved', { planId: 'p1', amountUsd: '100' });
    const line = firstLine(lines());
    expect(line.planId).toBe('p1');
    expect(line.amountUsd).toBe('100');
    expect(line.msg).toBe('reserved');
  });

  it('serialises Error objects into the `err` field (not the message string)', () => {
    const { svc, lines } = makeCapturingLogger({ serviceName: 'svc' });
    const err = new Error('boom');
    svc.error('failed', err);
    const line = firstLine(lines());
    const e = line.err as { message?: string; type?: string } | undefined;
    expect(e).toBeDefined();
    expect(e?.message).toBe('boom');
    expect(e?.type).toBe('Error');
    expect(line.msg).toBe('failed');
  });

  it('treats an Error as the message as an err-merge (single Error arg)', () => {
    const { svc, lines } = makeCapturingLogger({ serviceName: 'svc' });
    svc.error(new Error('top-level'));
    const line = firstLine(lines());
    const e = line.err as { message?: string } | undefined;
    expect(e?.message).toBe('top-level');
  });

  it('attaches correlationId from ALS when inside a correlation scope', () => {
    const { svc, lines } = makeCapturingLogger({ serviceName: 'svc' });
    runWithCorrelationId('corr-123', () => {
      svc.log('inside request');
    });
    const line = firstLine(lines());
    expect(line.correlationId).toBe('corr-123');
  });

  it('omits correlationId when no ALS store is set', () => {
    const { svc, lines } = makeCapturingLogger({ serviceName: 'svc' });
    svc.log('outside request');
    const line = firstLine(lines());
    expect(line.correlationId).toBeUndefined();
  });

  it('redacts sensitive object-property paths (K1.1)', () => {
    const { svc, lines } = makeCapturingLogger({ serviceName: 'svc' });
    svc.log('wallet op', { privateKey: '0xdeadbeef'.padEnd(64, '0'), planId: 'p1' });
    const line = firstLine(lines());
    expect(line.privateKey).toBe('[Redacted]');
    expect(line.planId).toBe('p1');
  });

  it('redacts mnemonic-shape key material', () => {
    const { svc, lines } = makeCapturingLogger({ serviceName: 'svc' });
    svc.log('importing', { mnemonic: 'abandon abandon abandon abandon abandon' });
    const line = firstLine(lines());
    expect(line.mnemonic).toBe('[Redacted]');
  });

  it('redacts auth header-shaped objects (K1.2)', () => {
    const { svc, lines } = makeCapturingLogger({ serviceName: 'svc' });
    svc.log('http', {
      req: { headers: { authorization: 'Bearer secret-token' } },
    });
    const line = firstLine(lines());
    const req = line.req as { headers?: { authorization?: string } } | undefined;
    expect(req?.headers?.authorization).toBe('[Redacted]');
  });

  it('honours LOG_LEVEL env (filters below threshold)', () => {
    process.env.LOG_LEVEL = 'warn';
    const { svc, lines } = makeCapturingLogger({ serviceName: 'svc' });
    svc.log('info-dropped');
    svc.warn('warn-kept');
    const msgs = lines().map((l) => l.msg);
    expect(msgs).toEqual(['warn-kept']);
  });

  it('accepts a custom service name and emits it on every line', () => {
    const { svc, lines } = makeCapturingLogger({ serviceName: 'execution-orchestrator' });
    svc.log('a');
    svc.log('b');
    const all = lines();
    expect(all.every((l) => l.service === 'execution-orchestrator')).toBe(true);
  });
});
