import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

const storage = new AsyncLocalStorage<string>();

const HEADER = 'x-correlation-id';

export function getCorrelationId(): string | undefined {
  return storage.getStore();
}

export function runWithCorrelationId<T>(
  correlationId: string,
  fn: () => T,
): T {
  return storage.run(correlationId, fn);
}

/** Fastify-compatible preHandler: set correlation id on request and ALS. */
export function correlationIdPreHandler(
  request: { headers: Record<string, string | string[] | undefined> },
  _reply: unknown,
  done: () => void,
): void {
  const headerVal = request.headers[HEADER];
  const fromHeader =
    typeof headerVal === 'string' && headerVal.length > 0
      ? headerVal
      : undefined;
  const id = fromHeader ?? randomUUID();
  Object.assign(request as object, { correlationId: id });
  runWithCorrelationId(id, () => done());
}
