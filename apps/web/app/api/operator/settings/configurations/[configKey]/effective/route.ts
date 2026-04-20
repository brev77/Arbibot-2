import { NextRequest, NextResponse } from 'next/server';

import { CONFIG_API_BASE } from '@/lib/api-base';
import { getOperatorSession } from '@/lib/operator-session';

const base = `${CONFIG_API_BASE}/policy/configurations`;

type RouteParams = { params: Promise<{ configKey: string }> };

/**
 * Read-through to config-service effective value (scope fallback: tenant → environment → global).
 */
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
    const environment = searchParams.get('environment') ?? undefined;
    const tenantId = searchParams.get('tenantId') ?? undefined;

    const params = new URLSearchParams();
    if (environment) params.append('environment', environment);
    if (tenantId) params.append('tenantId', tenantId);

    const qs = params.toString();
    const url = `${base}/${encodeURIComponent(configKey)}/effective${qs ? `?${qs}` : ''}`;

    const response = await fetch(url, {
      headers: { 'Content-Type': 'application/json' },
      cache: 'no-store',
    });

    if (!response.ok) {
      const errBody = await response.json().catch(() => ({}));
      return NextResponse.json(
        errBody && typeof errBody === 'object' && errBody !== null
          ? errBody
          : { error: `Config API error: ${response.status}` },
        { status: response.status },
      );
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error('Failed to fetch effective configuration:', error);
    return NextResponse.json(
      { error: 'Failed to fetch effective configuration' },
      { status: 500 },
    );
  }
}
