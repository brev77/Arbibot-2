import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

import { getOperatorSession } from '@/lib/operator-session';
import { proxyScanner } from '@/lib/scanner-bff';

interface Params {
  id: string;
}

/**
 * BFF proxy: `POST /api/operator/scanners/instances/:id/run` → scanner-service
 * `POST /scanner/instances/:id/run`. Manual trigger of one instance detection cycle.
 * Operator session required.
 */
export async function POST(
  _request: NextRequest,
  context: { params: Promise<Params> },
): Promise<NextResponse> {
  const session = await getOperatorSession();
  if (session === null) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { id } = await context.params;
  return proxyScanner('POST', ['instances', id, 'run'], {
    extraHeaders: { 'x-operator-id': session.operatorId },
  });
}
