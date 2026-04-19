import { NextRequest, NextResponse } from 'next/server';

import { apiBases } from '@/lib/api-base';
import { getOperatorSession } from '@/lib/operator-session';

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ routeKey: string }> },
): Promise<NextResponse> {
  const session = await getOperatorSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { routeKey } = await context.params;
  if (!routeKey || routeKey.trim().length === 0) {
    return NextResponse.json({ error: 'routeKey required' }, { status: 400 });
  }

  const encoded = encodeURIComponent(routeKey);
  const url = `${apiBases.risk}/policy/route-scoring-history/${encoded}`;

  try {
    const response = await fetch(url, {
      headers: { 'Content-Type': 'application/json' },
    });

    if (!response.ok) {
      const text = await response.text();
      return NextResponse.json(
        { error: `Risk API error: ${response.status}`, detail: text.slice(0, 500) },
        { status: response.status },
      );
    }

    const data: unknown = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error('Failed to fetch route scoring history:', error);
    return NextResponse.json(
      { error: 'Failed to fetch route scoring history' },
      { status: 500 },
    );
  }
}
