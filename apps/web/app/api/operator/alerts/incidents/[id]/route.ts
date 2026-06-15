import { apiBases } from '@/lib/api-base';
import { proxyUpstream } from '@/lib/operator-bff-proxy';

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(
  req: Request,
  ctx: RouteContext,
): Promise<Response> {
  const { id } = await ctx.params;
  const body = await req.text();
  return proxyUpstream(`${apiBases.reconciliation}/alerts/incidents/${id}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body,
  });
}