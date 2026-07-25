import { randomUUID } from 'node:crypto';

import { NextResponse } from 'next/server';

import { apiBases } from '@/lib/api-base';

/**
 * Scanner-service BFF helpers (S4-2-BFF).
 *
 * `/api/operator/scanners/*` routes proxy to `scanner-service` (`SCANNER_API_BASE`, default
 * 3021) — never call scanner-service from the browser. All routes require an operator session
 * (checked in each route handler via {@link getOperatorSession}); this helper assumes the caller
 * has already authorized and only forwards the request with an `x-operator-id` header.
 */

function scannerBase(): string {
  return apiBases.scanner.replace(/\/$/, '');
}

/**
 * Forward a request to `scanner-service` `/scanner/...`. Returns the upstream body verbatim
 * with status + content-type preserved, plus a fresh `x-correlation-id`.
 *
 * @param method  HTTP method.
 * @param path    Path segments after `/scanner/` (e.g. `['instances', id, 'run']`).
 * @param init    Extra fetch init (body, search string, extra headers).
 */
export async function proxyScanner(
  method: string,
  path: string[],
  init: {
    search?: string;
    body?: string;
    extraHeaders?: Record<string, string>;
  } = {},
): Promise<NextResponse> {
  const suffix = path.map((s) => encodeURIComponent(s)).join('/');
  const url = `${scannerBase()}/scanner/${suffix}${init.search ?? ''}`;
  const correlationId =
    init.extraHeaders?.['x-correlation-id']?.trim() || randomUUID();

  const headers: Record<string, string> = {
    accept: 'application/json',
    'x-correlation-id': correlationId,
    ...(init.extraHeaders ?? {}),
  };
  if (init.body !== undefined) {
    headers['content-type'] = 'application/json';
  }

  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers,
      body: init.body,
      cache: 'no-store',
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: 'Failed to reach scanner-service', detail: msg },
      { status: 502 },
    );
  }

  const body = await res.text();
  return new NextResponse(body, {
    status: res.status,
    headers: {
      'content-type':
        res.headers.get('content-type') ?? 'application/json; charset=utf-8',
      'x-correlation-id': correlationId,
    },
  });
}
