import { NextRequest } from 'next/server';

import { apiBases } from '@/lib/api-base';
import { proxyUpstream } from '@/lib/operator-bff-proxy';

/** Read-through proxy to paper-trading-service GET /paper/trades/history (PAD-6). */
export async function GET(request: NextRequest): Promise<Response> {
  const sp = request.nextUrl.searchParams;
  const qs = sp.toString();
  const url = `${apiBases.paper}/paper/trades/history${qs.length > 0 ? `?${qs}` : ''}`;
  return proxyUpstream(url);
}
