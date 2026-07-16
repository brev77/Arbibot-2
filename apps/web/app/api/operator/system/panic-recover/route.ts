import { NextRequest, NextResponse } from 'next/server';

import { CONFIG_API_BASE } from '@/lib/api-base';
import { getOperatorSession } from '@/lib/operator-session';

/**
 * BFF proxy for panic recovery (D4-C-3-PANIC). Forwards to config-service
 * `POST /policy/system/panic-recover`, injecting `operatorId`. The typed
 * `confirm` phrase is required by the backend and enforced there; the UI collects
 * it and passes it through.
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
    if (typeof body.confirm !== 'string' || body.confirm.length === 0) {
      return NextResponse.json(
        { error: 'confirm phrase required' },
        { status: 400 },
      );
    }
    const response = await fetch(`${CONFIG_API_BASE}/policy/system/panic-recover`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        confirm: body.confirm,
        reason: typeof body.reason === 'string' ? body.reason : undefined,
        operatorId: session.operatorId,
      }),
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      return NextResponse.json(
        data ?? { error: 'Failed to recover from panic' },
        { status: response.status },
      );
    }
    return NextResponse.json(data);
  } catch (error) {
    console.error('panic-recover BFF failed:', error);
    return NextResponse.json(
      { error: 'Failed to recover from panic' },
      { status: 500 },
    );
  }
}
