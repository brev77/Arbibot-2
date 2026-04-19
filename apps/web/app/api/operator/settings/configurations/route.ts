import { NextRequest, NextResponse } from 'next/server';

import { CONFIG_API_BASE } from '@/lib/api-base';
import { getOperatorSession } from '@/lib/operator-session';

const CONFIG_API_ENDPOINT = `${CONFIG_API_BASE}/policy/configurations`;

export async function GET(request: NextRequest): Promise<NextResponse> {
  const session = await getOperatorSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const scopeType = searchParams.get('scopeType') || undefined;
    const scopeValue = searchParams.get('scopeValue') || undefined;
    const environment = searchParams.get('environment') || undefined;
    const tenantId = searchParams.get('tenantId') || undefined;

    // Build query params for config-service
    const params = new URLSearchParams();
    if (scopeType) params.append('scopeType', scopeType);
    if (scopeValue) params.append('scopeValue', scopeValue);
    if (environment) params.append('environment', environment);
    if (tenantId) params.append('tenantId', tenantId);

    const response = await fetch(
      `${CONFIG_API_ENDPOINT}?${params.toString()}`,
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
    console.error('Failed to fetch configurations:', error);
    return NextResponse.json(
      { error: 'Failed to fetch configurations' },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const session = await getOperatorSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (session.role !== 'operator' && session.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const body = await request.json();

    // Add operatorId to request body
    const configBody = {
      ...body,
      operatorId: session.operatorId,
    };

    const response = await fetch(CONFIG_API_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(configBody),
    });

    if (!response.ok) {
      const errorData = await response.json();
      return NextResponse.json(
        errorData || { error: 'Failed to create configuration' },
        { status: response.status },
      );
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error('Failed to create configuration:', error);
    return NextResponse.json(
      { error: 'Failed to create configuration' },
      { status: 500 },
    );
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: { configKey: string } },
): Promise<NextResponse> {
  const session = await getOperatorSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (session.role !== 'operator' && session.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const { configKey } = params;
    const body = await request.json();

    // Add operatorId to request body
    const configBody = {
      ...body,
      operatorId: session.operatorId,
    };

    const response = await fetch(
      `${CONFIG_API_ENDPOINT}/${configKey}`,
      {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(configBody),
      },
    );

    if (!response.ok) {
      const errorData = await response.json();
      return NextResponse.json(
        errorData || { error: 'Failed to update configuration' },
        { status: response.status },
      );
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error('Failed to update configuration:', error);
    return NextResponse.json(
      { error: 'Failed to update configuration' },
      { status: 500 },
    );
  }
}

export async function POST_rollback(
  request: NextRequest,
  { params }: { params: { configKey: string } },
): Promise<NextResponse> {
  const session = await getOperatorSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (session.role !== 'operator' && session.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const { configKey } = params;
    const body = await request.json();

    // Add operatorId to request body
    const rollbackBody = {
      ...body,
      operatorId: session.operatorId,
    };

    const response = await fetch(
      `${CONFIG_API_ENDPOINT}/${configKey}/rollback`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(rollbackBody),
      },
    );

    if (!response.ok) {
      const errorData = await response.json();
      return NextResponse.json(
        errorData || { error: 'Failed to rollback configuration' },
        { status: response.status },
      );
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error('Failed to rollback configuration:', error);
    return NextResponse.json(
      { error: 'Failed to rollback configuration' },
      { status: 500 },
    );
  }
}

export async function GET_history(
  request: NextRequest,
  { params }: { params: { configKey: string } },
): Promise<NextResponse> {
  const session = await getOperatorSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { configKey } = params;
    const { searchParams } = new URL(request.url);
    const scopeType = searchParams.get('scopeType') || 'global';
    const scopeValue = searchParams.get('scopeValue') || null;

    const params = new URLSearchParams();
    params.append('scopeType', scopeType);
    if (scopeValue) params.append('scopeValue', scopeValue);

    const response = await fetch(
      `${CONFIG_API_ENDPOINT}/${configKey}/history?${params.toString()}`,
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
