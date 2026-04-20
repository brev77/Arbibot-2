import { NextResponse } from 'next/server';

import { apiBases } from '@/lib/api-base';
import { getOperatorSession } from '@/lib/operator-session';

export async function GET(): Promise<NextResponse> {
  const session = await getOperatorSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const url = `${apiBases.marketIntake}/health/degradation`;

  try {
    const response = await fetch(url, {
      headers: { 'Content-Type': 'application/json' },
      cache: 'no-store',
    });

    if (!response.ok) {
      const text = await response.text();
      return NextResponse.json(
        {
          error: `Market intake error: ${response.status}`,
          detail: text.slice(0, 500),
        },
        { status: response.status },
      );
    }

    const data: unknown = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error('Failed to fetch intake degradation:', error);
    return NextResponse.json(
      { error: 'Failed to fetch intake degradation' },
      { status: 500 },
    );
  }
}
