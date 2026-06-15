import { apiBases } from '@/lib/api-base';
import { proxyUpstream } from '@/lib/operator-bff-proxy';

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const status = url.searchParams.get('status');
  const qs = status !== null ? `?status=${encodeURIComponent(status)}` : '';
  return proxyUpstream(`${apiBases.reconciliation}/alerts/incidents${qs}`);
}