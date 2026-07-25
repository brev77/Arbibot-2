import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

import { getOperatorSession } from '@/lib/operator-session';
import { proxyScanner } from '@/lib/scanner-bff';

interface Params {
  id: string;
}

/**
 * BFF proxy: `POST /api/operator/scanners/instances/:id/refresh-config` → scanner-service
 * `POST /scanner/instances/:id/refresh-config`. Force-refreshes the config cache so an
 * operator `/settings` change applies immediately instead of waiting for the TTL.
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
  return proxyScanner('POST', ['instances', id, 'refresh-config'], {
    extraHeaders: { 'x-operator-id': session.operatorId },
  });
}
