/** Read models returned via BFF `/api/operator/openclaw/v1/*` (aligned with gateway + upstream). */

import type { AuditListItem } from '@/lib/audit-types';

export type OpenclawDashboardSummary = {
  incidentsOpenCount: number;
  incidentsResolvedTodayCount: number;
  capitalPositionsCount: number;
  capitalTotalNotionalUsd: string;
  lastUpdated: string;
};

export type OpenclawPlansPage = {
  items: unknown[];
  nextCursor: string | null;
  limit: number;
};

export type OpenclawIncidentBriefItem = {
  readonly id: string;
  readonly kind: string;
  readonly status: string;
  readonly summary: string;
  readonly updatedAt: string;
};

export type OpenclawIncidentBriefs = {
  readonly items: OpenclawIncidentBriefItem[];
};

export type OpenclawApprovalsQueue = {
  readonly items: AuditListItem[];
};

export type OpenclawSafeModeState = {
  readonly enabled: boolean;
  readonly updatedAt: string;
  readonly reason: string | null;
  readonly updatedByOperatorId: string | null;
};

export type OpenclawSafeModeStatus = {
  readonly safeMode: OpenclawSafeModeState;
};

export type OpenclawSessionsInfo = {
  readonly items: unknown[];
  readonly note: string;
};

export type OpenclawPositionRow = {
  readonly id: string;
  readonly planId: string | null;
  readonly instrumentKey: string;
  readonly quantity: string;
  readonly entityVersion: number;
  readonly createdAt: string;
  readonly updatedAt: string;
};

export type OpenclawPositionsPage = {
  readonly items: OpenclawPositionRow[];
};
