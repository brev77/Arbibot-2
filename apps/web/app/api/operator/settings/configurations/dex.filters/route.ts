import { NextRequest, NextResponse } from 'next/server';
import { CONFIG_API_BASE } from '@/lib/api-base';

/**
 * GET /api/operator/settings/configurations/dex.filters
 * Get DEX filters configuration (effective or latest)
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const effective = searchParams.get('effective') === 'true';
    const environment = searchParams.get('environment') || undefined;
    const tenantId = searchParams.get('tenantId') || undefined;

    // Build query params
    const queryParams = new URLSearchParams();
    if (environment) queryParams.append('environment', environment);
    if (tenantId) queryParams.append('tenantId', tenantId);

    // Use effective endpoint if requested
    const endpoint = effective 
      ? `${CONFIG_API_BASE}/policy/configurations/dex.filters/effective?${queryParams}`
      : `${CONFIG_API_BASE}/policy/configurations/dex.filters?${queryParams}`;

    const response = await fetch(endpoint, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const error = await response.text();
      return NextResponse.json(
        { error: 'Failed to fetch DEX filters configuration', details: error },
        { status: response.status }
      );
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error('Error in dex.filters GET route:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/operator/settings/configurations/dex.filters
 * Update DEX filters configuration
 */
export async function PUT(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const environment = searchParams.get('environment') || undefined;
    const tenantId = searchParams.get('tenantId') || undefined;

    const body = await request.json();

    // Build query params
    const queryParams = new URLSearchParams();
    if (environment) queryParams.append('environment', environment);
    if (tenantId) queryParams.append('tenantId', tenantId);

    const response = await fetch(
      `${CONFIG_API_BASE}/policy/configurations/dex.filters?${queryParams}`,
      {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      }
    );

    if (!response.ok) {
      const error = await response.text();
      return NextResponse.json(
        { error: 'Failed to update DEX filters configuration', details: error },
        { status: response.status }
      );
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error('Error in dex.filters PUT route:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}