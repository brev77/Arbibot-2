import { NextRequest, NextResponse } from 'next/server';

import { CONFIG_API_BASE } from '@/lib/api-base';
import { getOperatorSession } from '@/lib/operator-session';

/**
 * BFF proxy for the operator "EMERGENCY STOP" button (D4-C-3-PANIC).
 * Forwards to config-service `POST /policy/system/panic-stop`, injecting
 * `operatorId` from the authenticated operator session. Operator role required.
 */
export async function POST(
  request: NextRequest,
): Promise<NextResponse> {
  const session = await getOperatorSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (session.role !== 'operator' && session.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const body = await request.json().catch(() => ({}));
    const response = await fetch(`${CONFIG_API_BASE}/policy/system/panic-stop`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        reason: typeof body.reason === 'string' ? body.reason : undefined,
        operatorId: session.operatorId,
      }),
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      return NextResponse.json(
        data ?? { error: 'Failed to trigger panic stop' },
        { status: response.status },
      );
    }
    return NextResponse.json(data);
  } catch (error) {
    console.error('panic-stop BFF failed:', error);
    return NextResponse.json(
      { error: 'Failed to trigger panic stop' },
      { status: 500 },
    );
  }
}
