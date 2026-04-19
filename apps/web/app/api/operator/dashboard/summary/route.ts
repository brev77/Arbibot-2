import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

import { fetchOperatorBffJson } from '@/lib/operator-client-api';
import type { DashboardSummary } from '@/lib/dashboard-types';
import type { ListResponse } from '@/lib/server-api';
import type { ReconciliationMismatchListItem } from '@/lib/reconciliation-types';
import type { PortfolioPositionListItem } from '@/lib/portfolio-types';

async function getIncidentsSummary(): Promise<{
  openCount: number;
  resolvedTodayCount: number;
}> {
  try {
    const mismatches = await fetchOperatorBffJson<ListResponse<ReconciliationMismatchListItem>>(
      '/reconciliation/mismatches?limit=100',
    );

    const openCount =
      mismatches.items.filter((m) => m.status === 'open').length ?? 0;
    const isoDate = new Date().toISOString();
    const today = isoDate.split('T')[0] ?? isoDate.slice(0, 10);
    const resolvedTodayCount =
      mismatches.items.filter(
        (m) => m.status === 'resolved' && m.createdAt?.startsWith(today),
      ).length ?? 0;

    return { openCount, resolvedTodayCount };
  } catch {
    return { openCount: 0, resolvedTodayCount: 0 };
  }
}

async function getCapitalSummary(): Promise<{
  positionsCount: number;
  totalNotionalUsd: string;
}> {
  try {
    const positions = await fetchOperatorBffJson<ListResponse<PortfolioPositionListItem>>(
      '/portfolio/positions?limit=1000',
    );

    const positionsCount = positions.items.length ?? 0;
    const totalNotionalUsd = positions.items
      .reduce((sum, p) => {
        const notional = p.notionalUsd ? Number.parseFloat(p.notionalUsd) : 0;
        return sum + notional;
      }, 0)
      .toFixed(2);

    return { positionsCount, totalNotionalUsd };
  } catch {
    return { positionsCount: 0, totalNotionalUsd: '0.00' };
  }
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const [incidents, capital] = await Promise.all([
    getIncidentsSummary(),
    getCapitalSummary(),
  ]);

  const summary: DashboardSummary = {
    incidentsOpenCount: incidents.openCount,
    incidentsResolvedTodayCount: incidents.resolvedTodayCount,
    capitalPositionsCount: capital.positionsCount,
    capitalTotalNotionalUsd: capital.totalNotionalUsd,
    lastUpdated: new Date().toISOString(),
  };

  return NextResponse.json(summary);
}
