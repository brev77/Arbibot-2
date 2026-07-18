/**
 * Normalize an upstream response body into a shape acceptable as an
 * `HttpException` response. Strings, arrays and objects pass through; other
 * primitives are stringified so the Fastify reply is always serializable.
 *
 * Extracted (Plan 6) from the previous duplicates in
 * `hermes.controller.ts` and `hermes-mutation.service.ts`.
 */
export function asExceptionBody(
  body: unknown,
): string | Record<string, unknown> | unknown[] {
  if (typeof body === 'string') {
    return body;
  }
  if (Array.isArray(body)) {
    return body;
  }
  if (typeof body === 'object' && body !== null) {
    return body as Record<string, unknown>;
  }
  return String(body);
}
