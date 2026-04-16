import { NextResponse } from 'next/server';

/** Server-side proxy: forward JSON body and status from upstream Nest services. */
export async function proxyUpstream(
  upstreamUrl: string,
  init?: RequestInit,
): Promise<NextResponse> {
  const res = await fetch(upstreamUrl, {
    ...init,
    headers: {
      accept: 'application/json',
      ...(init?.headers as Record<string, string> | undefined),
    },
    cache: 'no-store',
  });
  const body = await res.text();
  return new NextResponse(body, {
    status: res.status,
    headers: {
      'content-type':
        res.headers.get('content-type') ?? 'application/json; charset=utf-8',
    },
  });
}
