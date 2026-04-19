import { NextRequest, NextResponse } from 'next/server';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const searchParams = request.nextUrl.searchParams;
  const action = searchParams.get('action');

  if (!action || !['approve', 'reject'].includes(action)) {
    return NextResponse.json(
      { error: 'Invalid action. Must be one of: approve, reject' },
      { status: 400 },
    );
  }

  try {
    const body = await request.json().catch(() => ({}));
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
    };

    const operatorSession = request.cookies.get('arbibot_session');
    if (operatorSession?.value) {
      try {
        const session = JSON.parse(operatorSession.value);
        if (session.role) {
          headers['x-operator-id'] = session.role;
        }
      } catch {
        // ignore parse error
      }
    }

    const response = await fetch(
      `${process.env.PAPER_API_BASE || 'http://127.0.0.1:3018'}/paper/promotion-candidates/${encodeURIComponent(id)}/${encodeURIComponent(action)}`,
      {
        method: 'POST',
        headers,
        body: Object.keys(body).length > 0 ? JSON.stringify(body) : undefined,
      },
    );

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      return NextResponse.json(
        { error: (errorData as { error?: string }).error || 'Failed to perform action' },
        { status: response.status },
      );
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error(`Failed to ${action} promotion candidate ${id}:`, error);
    return NextResponse.json(
      { error: `Failed to ${action} promotion candidate` },
      { status: 500 },
    );
  }
}
