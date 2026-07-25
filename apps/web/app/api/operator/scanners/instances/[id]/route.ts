import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

import { getOperatorSession } from '@/lib/operator-session';
import { proxyScanner } from '@/lib/scanner-bff';

interface Params {
  id: string;
}

/**
 * BFF proxy for a single scanner instance.
 *
 * - `GET /api/operator/scanners/instances/:id` → `GET /scanner/instances/:id`
 *   (instance definition + worker runtime status).
 *
 * Operator session required for all methods.
 */
export async function GET(
  _request: NextRequest,
  context: { params: Promise<Params> },
): Promise<NextResponse> {
  const session = await getOperatorSession();
  if (session === null) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { id } = await context.params;
  return proxyScanner('GET', ['instances', id], {
    extraHeaders: { 'x-operator-id': session.operatorId },
  });
}
