import { apiBases } from '@/lib/api-base';
import { proxyUpstream } from '@/lib/operator-bff-proxy';

/**
 * BFF proxy → execution-orchestrator `GET /execution/plans/:id/on-chain-txs`.
 * Step: DEX-FE-P2
 */
export async function GET(
  _request: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await ctx.params;
  return proxyUpstream(`${apiBases.execution}/execution/plans/${id}/on-chain-txs`);
}