import { NextResponse } from 'next/server';

import { apiBases } from '@/lib/api-base';
import { getOperatorSession } from '@/lib/operator-session';

/**
 * BFF proxy to execution-orchestrator DEX health endpoint.
 * Step: DEX-1-2-HEALTH
 */
export async function GET(): Promise<NextResponse> {
  const session = await getOperatorSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const url = `${apiBases.execution}/health/dex`;

  try {
    const response = await fetch(url, {
      headers: { 'Content-Type': 'application/json' },
      cache: 'no-store',
    });

    if (!response.ok) {
      const text = await response.text();
      return NextResponse.json(
        {
          error: `Execution orchestrator error: ${response.status}`,
          detail: text.slice(0, 500),
        },
        { status: response.status },
      );
    }

    const data: unknown = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error('Failed to fetch DEX health:', error);
    return NextResponse.json(
      { error: 'Failed to fetch DEX health' },
      { status: 500 },
    );
  }
}