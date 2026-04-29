import { NextRequest, NextResponse } from 'next/server';
import { OPPORTUNITY_API_BASE } from '@/lib/api-base';

export async function GET() {
  try {
    const response = await fetch(`${OPPORTUNITY_API_BASE}/opportunities/metrics/dex-filters`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const error = await response.text();
      return NextResponse.json(
        { error: 'Failed to fetch DEX filters metrics', details: error },
        { status: response.status }
      );
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error('Error in metrics/dex-filters route:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}