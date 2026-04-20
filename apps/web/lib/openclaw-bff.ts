import { randomUUID } from 'node:crypto';

import { NextResponse } from 'next/server';

import type { OperatorSession } from '@/lib/operator-session';

function gatewayBase(): string | null {
  const b = process.env.OPENCLAW_GATEWAY_URL?.trim();
  return b !== undefined && b.length > 0 ? b.replace(/\/$/, '') : null;
}

/** Server-only key used by the web BFF to authenticate to openclaw-gateway. */
function bffOpenclawApiKey(): string | null {
  const k =
    process.env.OPENCLAW_BFF_API_KEY?.trim() ??
    process.env.OPENCLAW_GATEWAY_API_KEY?.trim();
  return k !== undefined && k.length > 0 ? k : null;
}

function notConfigured(): NextResponse {
  return NextResponse.json(
    {
      error: 'OpenClaw gateway not configured',
      hint: 'Set OPENCLAW_GATEWAY_URL and OPENCLAW_BFF_API_KEY (server-side only)',
    },
    { status: 503 },
  );
}

/**
 * Forward a GET to `openclaw-gateway` (`/openclaw/v1/...`) with API key auth.
 * Used by `/api/operator/openclaw/v1/*` routes — never call from the browser with a secret.
 */
export async function proxyOpenclawGatewayGet(
  pathSegments: string[],
  search: string,
  incomingHeaders: Headers,
): Promise<NextResponse> {
  const base = gatewayBase();
  const key = bffOpenclawApiKey();
  if (base === null || key === null) {
    return notConfigured();
  }

  const suffix = pathSegments.join('/');
  const url = `${base}/openclaw/v1/${suffix}${search}`;

  const correlationId =
    incomingHeaders.get('x-correlation-id')?.trim() || randomUUID();

  const res = await fetch(url, {
    method: 'GET',
    headers: {
      accept: 'application/json',
      'x-openclaw-api-key': key,
      'x-correlation-id': correlationId,
    },
    cache: 'no-store',
  });

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

/**
 * Merge operator session into JSON body for mutation endpoints that require `operatorId`.
 */
export function mergeOperatorIntoBody(
  body: Record<string, unknown>,
  session: OperatorSession | null,
): Record<string, unknown> {
  const op =
    typeof body.operatorId === 'string' && body.operatorId.trim().length > 0
      ? body.operatorId
      : session?.operatorId;
  if (op === undefined || op.length === 0) {
    return body;
  }
  return { ...body, operatorId: op };
}

/**
 * Forward POST/PATCH to `openclaw-gateway` with API key and optional operator header.
 */
export async function proxyOpenclawGatewayWrite(
  method: 'POST' | 'PATCH',
  pathSegments: string[],
  search: string,
  bodyJson: Record<string, unknown> | undefined,
  incomingHeaders: Headers,
): Promise<NextResponse> {
  const base = gatewayBase();
  const key = bffOpenclawApiKey();
  if (base === null || key === null) {
    return notConfigured();
  }

  const suffix = pathSegments.join('/');
  const url = `${base}/openclaw/v1/${suffix}${search}`;

  const correlationId =
    incomingHeaders.get('x-correlation-id')?.trim() || randomUUID();

  const headers: Record<string, string> = {
    accept: 'application/json',
    'content-type': 'application/json',
    'x-openclaw-api-key': key,
    'x-correlation-id': correlationId,
  };
  const opHeader = incomingHeaders.get('x-operator-id')?.trim();
  if (opHeader !== undefined && opHeader.length > 0) {
    headers['x-operator-id'] = opHeader;
  }

  const res = await fetch(url, {
    method,
    headers,
    body:
      bodyJson !== undefined && Object.keys(bodyJson).length > 0
        ? JSON.stringify(bodyJson)
        : method === 'POST'
          ? '{}'
          : undefined,
    cache: 'no-store',
  });

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
