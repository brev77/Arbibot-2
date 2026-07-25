import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

import { getOperatorSession } from '@/lib/operator-session';
import { proxyScanner } from '@/lib/scanner-bff';

interface Params {
  id: string;
}

/**
 * BFF proxy for a single scanner finding.
 *
 * - `GET /api/operator/scanners/findings/:id` → `GET /scanner/findings/:id`
 *
 * Operator session required.
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
  return proxyScanner('GET', ['findings', id], {
    extraHeaders: { 'x-operator-id': session.operatorId },
  });
}
