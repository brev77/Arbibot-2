import { NextResponse } from 'next/server';

import { getOperatorSession } from '@/lib/operator-session';
import { proxyScanner } from '@/lib/scanner-bff';

/**
 * BFF proxy: `GET /api/operator/scanners/status` → scanner-service `GET /scanner/status`.
 * Composite worker status snapshot (isShuttingDown, scheduled/running instance ids).
 * Operator session required.
 */
export async function GET(): Promise<NextResponse> {
  const session = await getOperatorSession();
  if (session === null) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return proxyScanner('GET', ['status'], {
    extraHeaders: { 'x-operator-id': session.operatorId },
  });
}
