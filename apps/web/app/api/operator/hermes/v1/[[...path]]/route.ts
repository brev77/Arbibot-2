import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

import {
  mergeOperatorIntoBody,
  proxyHermesGatewayGet,
  proxyHermesGatewayWrite,
} from '@/lib/hermes-bff';
import { getOperatorSession } from '@/lib/operator-session';

/**
 * BFF proxy: `/api/operator/hermes/v1/*` → `HERMES_GATEWAY_URL/hermes/v1/*`
 * with server-side `HERMES_BFF_API_KEY`. Clients call this route without secrets.
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ path?: string[] }> },
): Promise<Response> {
  const { path = [] } = await context.params;
  if (path.length === 0) {
    return Response.json(
      { error: 'Specify a resource, e.g. /api/operator/hermes/v1/plans' },
      { status: 404 },
    );
  }

  const search = request.nextUrl.search;
  return proxyHermesGatewayGet(path, search, request.headers);
}

async function parseJsonBody(
  request: NextRequest,
): Promise<{ ok: true; body: Record<string, unknown> } | { ok: false; response: NextResponse }> {
  const text = await request.text();
  if (text.trim().length === 0) {
    return { ok: true, body: {} };
  }
  try {
    const parsed = JSON.parse(text) as unknown;
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return {
        ok: false,
        response: NextResponse.json({ error: 'JSON body must be an object' }, { status: 400 }),
      };
    }
    return { ok: true, body: parsed as Record<string, unknown> };
  } catch {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }),
    };
  }
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ path?: string[] }> },
): Promise<Response> {
  const { path = [] } = await context.params;
  if (path.length === 0) {
    return Response.json({ error: 'Specify a resource path' }, { status: 404 });
  }
  const parsed = await parseJsonBody(request);
  if (!parsed.ok) {
    return parsed.response;
  }
  const session = await getOperatorSession();
  if (session === null) {
    return NextResponse.json({ error: 'Operator session required' }, { status: 401 });
  }
  const merged = mergeOperatorIntoBody(parsed.body, session);
  const headers = new Headers(request.headers);
  headers.set('x-operator-id', session.operatorId);
  const search = request.nextUrl.search;
  return proxyHermesGatewayWrite('POST', path, search, merged, headers);
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ path?: string[] }> },
): Promise<Response> {
  const { path = [] } = await context.params;
  if (path.length === 0) {
    return Response.json({ error: 'Specify a resource path' }, { status: 404 });
  }
  const parsed = await parseJsonBody(request);
  if (!parsed.ok) {
    return parsed.response;
  }
  const session = await getOperatorSession();
  if (session === null) {
    return NextResponse.json({ error: 'Operator session required' }, { status: 401 });
  }
  const merged = mergeOperatorIntoBody(parsed.body, session);
  const headers = new Headers(request.headers);
  headers.set('x-operator-id', session.operatorId);
  const search = request.nextUrl.search;
  return proxyHermesGatewayWrite('PATCH', path, search, merged, headers);
}
