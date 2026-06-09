/** Read models returned via BFF `/api/operator/hermes/v1/*` (aligned with gateway + upstream). */

import type { AuditListItem } from '@/lib/audit-types';

export type HermesDashboardSummary = {
  incidentsOpenCount: number;
  incidentsResolvedTodayCount: number;
  capitalPositionsCount: number;
  capitalTotalNotionalUsd: string;
  lastUpdated: string;
};

export type HermesPlansPage = {
  items: unknown[];
  nextCursor: string | null;
  limit: number;
};

export type HermesIncidentBriefItem = {
  readonly id: string;
  readonly kind: string;
  readonly status: string;
  readonly summary: string;
  readonly updatedAt: string;
};

export type HermesIncidentBriefs = {
  readonly items: HermesIncidentBriefItem[];
};

export type HermesApprovalsQueue = {
  readonly items: AuditListItem[];
};

export type HermesSafeModeState = {
  readonly enabled: boolean;
  readonly updatedAt: string;
  readonly reason: string | null;
  readonly updatedByOperatorId: string | null;
};

export type HermesSafeModeStatus = {
  readonly safeMode: HermesSafeModeState;
};

export type HermesSessionsInfo = {
  readonly items: unknown[];
  readonly note: string;
};

export type HermesPositionRow = {
  readonly id: string;
  readonly planId: string | null;
  readonly instrumentKey: string;
  readonly quantity: string;
  readonly entityVersion: number;
  readonly createdAt: string;
  readonly updatedAt: string;
};

export type HermesPositionsPage = {
  readonly items: HermesPositionRow[];
};