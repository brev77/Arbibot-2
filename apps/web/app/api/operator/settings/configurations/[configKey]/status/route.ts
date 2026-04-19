import { NextRequest, NextResponse } from 'next/server';

import { CONFIG_API_BASE } from '@/lib/api-base';
import { getOperatorSession } from '@/lib/operator-session';

const base = `${CONFIG_API_BASE}/policy/configurations`;

type RouteParams = { params: Promise<{ configKey: string }> };

export async function PATCH(
  request: NextRequest,
  context: RouteParams,
): Promise<NextResponse> {
  const session = await getOperatorSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (session.role !== 'operator' && session.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const { configKey } = await context.params;
    const body = await request.json();

    const configBody = {
      ...body,
      operatorId: session.operatorId,
    };

    const response = await fetch(
      `${base}/${encodeURIComponent(configKey)}/status`,
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(configBody),
      },
    );

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      return NextResponse.json(
        errorData || { error: 'Failed to update configuration status' },
        { status: response.status },
      );
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error('Failed to update configuration status:', error);
    return NextResponse.json(
      { error: 'Failed to update configuration status' },
      { status: 500 },
    );
  }
}
