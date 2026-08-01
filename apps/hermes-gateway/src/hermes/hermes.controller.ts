import {
  Controller,
  Get,
  HttpException,
  Param,
  ParseUUIDPipe,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';

import { HermesAuthGuard } from './hermes-auth.guard';
import {
  getAuditApiBase,
  getExecutionApiBase,
  getOperatorWebBffBase,
  getPortfolioApiBase,
  getReconciliationApiBase,
  getScannerApiBase,
} from './hermes-env';
import { IncidentBriefsService } from './incident-briefs.service';
import { HermesUpstreamService } from './hermes-upstream.service';
import { SafeModeService } from './safe-mode.service';

type ReqWithCorr = { correlationId?: string };

function getCorrelationId(req: ReqWithCorr): string | undefined {
  return typeof req.correlationId === 'string' && req.correlationId.length > 0
    ? req.correlationId
    : undefined;
}

function assertRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function planRowId(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return '';
}

function clampLimit(limitStr?: string): number {
  if (limitStr === undefined || limitStr === '') {
    return 50;
  }
  const n = Number.parseInt(limitStr, 10);
  if (Number.isNaN(n)) {
    return 50;
  }
  return Math.min(100, Math.max(1, n));
}

function paginatePlanItems(
  items: Record<string, unknown>[],
  limit: number,
  cursor?: string,
): { items: unknown[]; nextCursor: string | null } {
  let start = 0;
  if (cursor !== undefined && cursor.length > 0) {
    const idx = items.findIndex((it) => planRowId(it['id']) === cursor);
    if (idx === -1) {
      throw new HttpException(
        {
          message:
            'cursor does not match any plan in the current page (execution list is capped server-side)',
          cursor,
        },
        400,
      );
    }
    start = idx + 1;
  }

  const page = items.slice(start, start + limit);
  const last = page[page.length - 1];
  const hasMore = start + page.length < items.length;
  const nextId = last !== undefined ? planRowId(last['id']) : '';
  const nextCursor =
    hasMore && last !== undefined && nextId.length > 0 ? nextId : null;

  return { items: page, nextCursor };
}

@Controller('hermes/v1')
@UseGuards(HermesAuthGuard)
export class HermesController {
  constructor(
    private readonly upstream: HermesUpstreamService,
    private readonly incidentBriefsService: IncidentBriefsService,
    private readonly safeMode: SafeModeService,
  ) {}

  /** Cursor pagination over execution plan list (server returns newest-first, capped). */
  @Get('plans')
  async listPlans(
    @Req() req: ReqWithCorr,
    @Query('limit') limitStr?: string,
    @Query('cursor') cursor?: string,
  ): Promise<{
    items: unknown[];
    nextCursor: string | null;
    limit: number;
  }> {
    const base = getExecutionApiBase();
    const corr = getCorrelationId(req);
    const result = await this.upstream.getJson(
      `${base}/execution/plans`,
      corr,
    );
    if (result.status >= 400) {
      throw new HttpException(asExceptionBody(result.json), result.status);
    }

    const body = assertRecord(result.json);
    const itemsUnknown = body['items'];
    const rawItems = Array.isArray(itemsUnknown) ? itemsUnknown : [];
    const items = rawItems.map((it) =>
      typeof it === 'object' && it !== null && !Array.isArray(it)
        ? (it as Record<string, unknown>)
        : {},
    );

    const limit = clampLimit(limitStr);
    const page = paginatePlanItems(items, limit, cursor);

    return {
      items: page.items,
      nextCursor: page.nextCursor,
      limit,
    };
  }

  /** Plan summary plus legs list (read-only aggregate). */
  @Get('plans/:id')
  async getPlanDetail(
    @Req() req: ReqWithCorr,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ): Promise<{ plan: unknown; legs: unknown }> {
    const base = getExecutionApiBase();
    const corr = getCorrelationId(req);
    const [planRes, legsRes] = await Promise.all([
      this.upstream.getJson(`${base}/execution/plans/${id}`, corr),
      this.upstream.getJson(`${base}/execution/plans/${id}/legs`, corr),
    ]);
    if (planRes.status >= 400) {
      throw new HttpException(asExceptionBody(planRes.json), planRes.status);
    }
    if (legsRes.status >= 400) {
      throw new HttpException(asExceptionBody(legsRes.json), legsRes.status);
    }
    return { plan: planRes.json, legs: legsRes.json };
  }

  @Get('positions')
  async positions(@Req() req: ReqWithCorr): Promise<unknown> {
    const base = getPortfolioApiBase();
    const result = await this.upstream.getJson(
      `${base}/positions`,
      getCorrelationId(req),
    );
    if (result.status >= 400) {
      throw new HttpException(asExceptionBody(result.json), result.status);
    }
    return result.json;
  }

  /** Reconciliation mismatches as operator-visible incidents feed. */
  @Get('incidents')
  async incidents(@Req() req: ReqWithCorr): Promise<unknown> {
    const base = getReconciliationApiBase();
    const result = await this.upstream.getJson(
      `${base}/mismatches`,
      getCorrelationId(req),
    );
    if (result.status >= 400) {
      throw new HttpException(asExceptionBody(result.json), result.status);
    }
    return result.json;
  }

  // ─────────────────────────────────────────────────────────────────────
  // Alertmanager incidents read-through (P7-7 — Hermes alert pipeline).
  // Distinct from `/incidents` above: that reads reconciliation MISMATCHES
  // (`reconciliation_mismatches`), while this reads Prometheus/Alertmanager
  // alerts (`alertmanager_incidents`) forwarded by reconciliation-service
  // `/alerts/webhook`. Without this endpoint the Hermes agent could not see
  // Prometheus alerts at all (disk, ServiceDown, error-rate) — the structural
  // gap closed by P7-7. Optional `?status=open|firing|investigating|resolved`
  // filter; otherwise newest-first.
  // ─────────────────────────────────────────────────────────────────────
  @Get('alerts')
  async alerts(
    @Req() req: ReqWithCorr,
    @Query('status') status?: string,
  ): Promise<unknown> {
    const base = getReconciliationApiBase();
    const qs =
      status !== undefined && status.length > 0
        ? `?status=${encodeURIComponent(status)}`
        : '';
    const result = await this.upstream.getJson(
      `${base}/alerts/incidents${qs}`,
      getCorrelationId(req),
    );
    if (result.status >= 400) {
      throw new HttpException(asExceptionBody(result.json), result.status);
    }
    return result.json;
  }

  /** Aggregated dashboard summary from operator web BFF (read-through). */
  @Get('dashboard/summary')
  async dashboardSummary(@Req() req: ReqWithCorr): Promise<unknown> {
    const base = getOperatorWebBffBase();
    const result = await this.upstream.getJson(
      `${base}/api/operator/dashboard/summary`,
      getCorrelationId(req),
    );
    if (result.status >= 400) {
      throw new HttpException(asExceptionBody(result.json), result.status);
    }
    return result.json;
  }

  /** Short summaries derived from reconciliation mismatches. */
  @Get('incident-briefs')
  async getIncidentBriefs(@Req() req: ReqWithCorr): Promise<unknown> {
    return this.incidentBriefsService.buildBriefs(getCorrelationId(req));
  }

  /**
   * Recent audit entries (proxy) — informational queue for operator review; not a workflow engine.
   */
  @Get('approvals-queue')
  async approvalsQueue(
    @Req() req: ReqWithCorr,
    @Query('limit') limitStr?: string,
  ): Promise<unknown> {
    const base = getAuditApiBase();
    const lim =
      limitStr !== undefined && limitStr.length > 0
        ? Math.min(200, Math.max(1, Number.parseInt(limitStr, 10) || 50))
        : 50;
    const result = await this.upstream.getJson(
      `${base}/audit/entries?limit=${lim}`,
      getCorrelationId(req),
    );
    if (result.status >= 400) {
      throw new HttpException(asExceptionBody(result.json), result.status);
    }
    return result.json;
  }

  /** Placeholder until Hermes session registry exists. */
  @Get('sessions')
  sessions(): { items: unknown[]; note: string } {
    return {
      items: [],
      note: 'Hermes session registry is not configured in gateway v0; use audit approvals-queue for recent operator actions.',
    };
  }

  @Get('safe-mode/status')
  async safeModeStatus(): Promise<{ safeMode: Awaited<ReturnType<SafeModeService['getState']>> }> {
    return { safeMode: await this.safeMode.getState() };
  }

  // ─────────────────────────────────────────────────────────────────────
  // Scanner-service read-through (S4-4-HERMES)
  // Proxies `/hermes/v1/scanner/*` → scanner-service `/scanner/*`. Read-only —
  // scanner mutations (run / refresh-config / re-publish) stay on the operator
  // UI BFF where the operator session is enforced; Hermes only summarizes.
  // ─────────────────────────────────────────────────────────────────────

  /** Latest scanner findings, optionally filtered by instance / publish status. */
  @Get('scanner/findings')
  async scannerFindings(
    @Req() req: ReqWithCorr,
    @Query('instanceId') instanceId?: string,
    @Query('publishStatus') publishStatus?: string,
    @Query('limit') limitStr?: string,
  ): Promise<unknown> {
    const base = getScannerApiBase();
    const params = new URLSearchParams();
    if (instanceId !== undefined && instanceId.length > 0) {
      params.set('instanceId', instanceId);
    }
    if (publishStatus !== undefined && publishStatus.length > 0) {
      params.set('publishStatus', publishStatus);
    }
    const lim =
      limitStr !== undefined && limitStr.length > 0
        ? Math.min(100, Math.max(1, Number.parseInt(limitStr, 10) || 50))
        : 50;
    params.set('limit', String(lim));
    const qs = params.toString().length > 0 ? `?${params.toString()}` : '';
    const result = await this.upstream.getJson(
      `${base}/scanner/findings${qs}`,
      getCorrelationId(req),
    );
    if (result.status >= 400) {
      throw new HttpException(asExceptionBody(result.json), result.status);
    }
    return result.json;
  }

  /** Single scanner finding by id (for drilldown from a summary). */
  @Get('scanner/findings/:id')
  async scannerFinding(
    @Req() req: ReqWithCorr,
    @Param('id') id: string,
  ): Promise<unknown> {
    const base = getScannerApiBase();
    const result = await this.upstream.getJson(
      `${base}/scanner/findings/${encodeURIComponent(id)}`,
      getCorrelationId(req),
    );
    if (result.status >= 400) {
      throw new HttpException(asExceptionBody(result.json), result.status);
    }
    return result.json;
  }

  /** Scanner worker runtime status (scheduled / running instance ids). */
  @Get('scanner/status')
  async scannerStatus(@Req() req: ReqWithCorr): Promise<unknown> {
    const base = getScannerApiBase();
    const result = await this.upstream.getJson(
      `${base}/scanner/status`,
      getCorrelationId(req),
    );
    if (result.status >= 400) {
      throw new HttpException(asExceptionBody(result.json), result.status);
    }
    return result.json;
  }
}

/** Nest HttpException response body (object or string). */
function asExceptionBody(
  body: unknown,
): string | Record<string, unknown> | unknown[] {
  if (typeof body === 'string') {
    return body;
  }
  if (Array.isArray(body)) {
    return body;
  }
  if (typeof body === 'object' && body !== null) {
    return body as Record<string, unknown>;
  }
  return String(body);
}
