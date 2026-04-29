import { NextRequest, NextResponse } from 'next/server';
import { OPPORTUNITY_API_BASE } from '@/lib/api-base';

export async function POST(request: NextRequest) {
  try {
    const filters = await request.json();
    
    const response = await fetch(`${OPPORTUNITY_API_BASE}/opportunities/preview-filters`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(filters),
    });

    if (!response.ok) {
      const error = await response.text();
      return NextResponse.json(
        { error: 'Failed to preview filters', details: error },
        { status: response.status }
      );
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error('Error in preview-filters route:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}