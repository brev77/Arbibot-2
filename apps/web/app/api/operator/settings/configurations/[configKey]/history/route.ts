import { NextRequest, NextResponse } from 'next/server';

import { CONFIG_API_BASE } from '@/lib/api-base';
import { getOperatorSession } from '@/lib/operator-session';

const base = `${CONFIG_API_BASE}/policy/configurations`;

type RouteParams = { params: Promise<{ configKey: string }> };

export async function GET(
  request: NextRequest,
  context: RouteParams,
): Promise<NextResponse> {
  const session = await getOperatorSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { configKey } = await context.params;
    const { searchParams } = new URL(request.url);
    const scopeType = searchParams.get('scopeType') || 'global';
    const scopeValue = searchParams.get('scopeValue');

    const queryParams = new URLSearchParams();
    queryParams.append('scopeType', scopeType);
    if (scopeValue) queryParams.append('scopeValue', scopeValue);

    const response = await fetch(
      `${base}/${encodeURIComponent(configKey)}/history?${queryParams.toString()}`,
      {
        headers: {
          'Content-Type': 'application/json',
        },
      },
    );

    if (!response.ok) {
      throw new Error(`Config API error: ${response.status}`);
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error('Failed to fetch configuration history:', error);
    return NextResponse.json(
      { error: 'Failed to fetch configuration history' },
      { status: 500 },
    );
  }
}
