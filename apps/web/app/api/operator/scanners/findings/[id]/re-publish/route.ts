import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

import { getOperatorSession } from '@/lib/operator-session';
import { proxyScanner } from '@/lib/scanner-bff';

interface Params {
  id: string;
}

/**
 * BFF proxy: `POST /api/operator/scanners/findings/:id/re-publish` → scanner-service
 * `POST /scanner/findings/:id/re-publish`. Manual re-publish of a pending/failed finding to
 * opportunity-service (operator fallback when the orphan worker has exhausted retries).
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
  return proxyScanner('POST', ['findings', id, 're-publish'], {
    extraHeaders: { 'x-operator-id': session.operatorId },
  });
}
