import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

import {
  mergeOperatorIntoBody,
  proxyOpenclawGatewayGet,
  proxyOpenclawGatewayWrite,
} from '@/lib/openclaw-bff';
import { getOperatorSession } from '@/lib/operator-session';

/**
 * BFF proxy: `/api/operator/openclaw/v1/*` → `OPENCLAW_GATEWAY_URL/openclaw/v1/*`
 * with server-side `OPENCLAW_BFF_API_KEY`. Clients call this route without secrets.
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ path?: string[] }> },
): Promise<Response> {
  const { path = [] } = await context.params;
  if (path.length === 0) {
    return Response.json(
      { error: 'Specify a resource, e.g. /api/operator/openclaw/v1/plans' },
      { status: 404 },
    );
  }

  const search = request.nextUrl.search;
  return proxyOpenclawGatewayGet(path, search, request.headers);
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
  return proxyOpenclawGatewayWrite('POST', path, search, merged, headers);
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
  return proxyOpenclawGatewayWrite('PATCH', path, search, merged, headers);
}
