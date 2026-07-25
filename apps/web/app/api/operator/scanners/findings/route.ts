import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

import { getOperatorSession } from '@/lib/operator-session';
import { proxyScanner } from '@/lib/scanner-bff';

/**
 * BFF proxy: `GET /api/operator/scanners/findings` → scanner-service
 * `GET /scanner/findings` (optional `instanceId` / `publishStatus` / `limit` query).
 * Operator session required.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const session = await getOperatorSession();
  if (session === null) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return proxyScanner('GET', ['findings'], {
    search: request.nextUrl.search,
    extraHeaders: { 'x-operator-id': session.operatorId },
  });
}
