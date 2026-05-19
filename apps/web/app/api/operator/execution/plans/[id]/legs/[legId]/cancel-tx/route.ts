import { type NextRequest, NextResponse } from 'next/server';

import { apiBases } from '@/lib/api-base';

/**
 * POST /api/operator/execution/plans/:id/legs/:legId/cancel-tx
 * DEX operator action: cancel a pending on-chain tx by sending a zero-value tx with same nonce + higher gas.
 * Proxies to execution-orchestrator.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; legId: string }> },
) {
  const { id, legId } = await params;
  const body = await request.json();

  const res = await fetch(
    `${apiBases.execution}/execution/plans/${id}/legs/${legId}/cancel-tx`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  );

  const data = await res.json().catch(() => ({}));
  return NextResponse.json(data, { status: res.status });
}