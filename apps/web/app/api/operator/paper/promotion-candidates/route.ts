import type { NextRequest } from 'next/server';

import { apiBases } from '@/lib/api-base';
import { proxyUpstream } from '@/lib/operator-bff-proxy';

export async function GET(req: NextRequest): Promise<Response> {
  const qs = req.nextUrl.searchParams.toString();
  const suffix = qs.length > 0 ? `?${qs}` : '';
  return proxyUpstream(`${apiBases.paper}/paper/promotion-candidates${suffix}`);
}
