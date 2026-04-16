import { apiBases } from '@/lib/api-base';
import { proxyUpstream } from '@/lib/operator-bff-proxy';

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const limit = url.searchParams.get('limit') ?? '50';
  return proxyUpstream(`${apiBases.audit}/audit/entries?limit=${encodeURIComponent(limit)}`);
}
