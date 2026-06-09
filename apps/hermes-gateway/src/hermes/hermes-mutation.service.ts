import { HttpException, HttpStatus, Injectable } from '@nestjs/common';

import { AuditClientService } from '@arbibot/nest-platform';

import type { HermesOperatorMutationDto } from './dto/operator-mutation.dto';
import type { ResolveIncidentMutationDto } from './dto/operator-mutation.dto';
import type { SafeModeMutationDto } from './dto/safe-mode.dto';
import {
  getExecutionApiBase,
  getPortfolioApiBase,
  getReconciliationApiBase,
} from './hermes-env';
import { HermesUpstreamService } from './hermes-upstream.service';
import { SafeModeService } from './safe-mode.service';

@Injectable()
export class HermesMutationService {
  constructor(
    private readonly upstream: HermesUpstreamService,
    private readonly audit: AuditClientService,
    private readonly safeMode: SafeModeService,
  ) {}

  async armPlan(
    planId: string,
    dto: HermesOperatorMutationDto,
    correlationId?: string,
  ): Promise<unknown> {
    const base = getExecutionApiBase();
    const result = await this.upstream.postJson(
      `${base}/execution/plans/${planId}/arm`,
      undefined,
      correlationId,
    );
    await this.auditMutationResult('HERMES_ARM_PLAN', dto, planId, result, {
      correlationId,
    });
    if (result.status >= 400) {
      throw new HttpException(
        asExceptionBody(result.json),
        result.status >= 500 ? HttpStatus.BAD_GATEWAY : result.status,
      );
    }
    return result.json;
  }

  /** Maps to execution `POST /execution/plans/:planId/begin-execution`. */
  async beginExecution(
    planId: string,
    dto: HermesOperatorMutationDto,
    correlationId?: string,
  ): Promise<unknown> {
    const base = getExecutionApiBase();
    const result = await this.upstream.postJson(
      `${base}/execution/plans/${planId}/begin-execution`,
      undefined,
      correlationId,
    );
    await this.auditMutationResult(
      'HERMES_BEGIN_EXECUTION',
      dto,
      planId,
      result,
      { correlationId },
    );
    if (result.status >= 400) {
      throw new HttpException(
        asExceptionBody(result.json),
        result.status >= 500 ? HttpStatus.BAD_GATEWAY : result.status,
      );
    }
    return result.json;
  }

  async resolveIncident(
    mismatchId: string,
    dto: ResolveIncidentMutationDto,
    correlationId?: string,
  ): Promise<unknown> {
    const base = getReconciliationApiBase();
    const patchBody: Record<string, unknown> = { status: 'resolved' };
    if (dto.expectedEntityVersion !== undefined) {
      patchBody.expectedEntityVersion = dto.expectedEntityVersion;
    }
    const result = await this.upstream.patchJson(
      `${base}/mismatches/${mismatchId}`,
      patchBody,
      correlationId,
    );
    await this.auditMutationResult(
      'HERMES_RESOLVE_INCIDENT',
      dto,
      mismatchId,
      result,
      { correlationId, extra: { patchBody } },
    );
    if (result.status >= 400) {
      throw new HttpException(
        asExceptionBody(result.json),
        result.status >= 500 ? HttpStatus.BAD_GATEWAY : result.status,
      );
    }
    return result.json;
  }

  async closePosition(
    positionId: string,
    dto: HermesOperatorMutationDto,
    correlationId?: string,
  ): Promise<unknown> {
    const base = getPortfolioApiBase();
    const body: Record<string, unknown> = {
      operatorId: dto.operatorId,
    };
    if (dto.approveReason !== undefined) {
      body.approveReason = dto.approveReason;
    }
    if (dto.idempotencyKey !== undefined) {
      body.idempotencyKey = dto.idempotencyKey;
    }
    if (dto.expectedEntityVersion !== undefined) {
      body.expectedEntityVersion = dto.expectedEntityVersion;
    }
    const result = await this.upstream.postJson(
      `${base}/positions/${positionId}/close`,
      body,
      correlationId,
    );
    await this.auditMutationResult(
      'HERMES_CLOSE_POSITION',
      dto,
      positionId,
      result,
      { correlationId },
    );
    if (result.status >= 400) {
      throw new HttpException(
        asExceptionBody(result.json),
        result.status >= 500 ? HttpStatus.BAD_GATEWAY : result.status,
      );
    }
    return result.json;
  }

  async enableSafeMode(
    dto: SafeModeMutationDto,
    correlationId?: string,
  ): Promise<unknown> {
    const state = await this.safeMode.enable(dto.operatorId, dto.reason);
    await this.audit.appendEntry({
      correlationId,
      idempotencyKey: dto.idempotencyKey,
      actor: dto.operatorId,
      action: 'HERMES_SAFE_MODE_ENABLE',
      resourceType: 'safe_mode',
      resourceId: 'global',
      payload: {
        reason: dto.reason ?? null,
        state,
      },
    });
    return { safeMode: state };
  }

  async disableSafeMode(
    dto: SafeModeMutationDto,
    correlationId?: string,
  ): Promise<unknown> {
    const state = await this.safeMode.disable(dto.operatorId, dto.reason);
    await this.audit.appendEntry({
      correlationId,
      idempotencyKey: dto.idempotencyKey,
      actor: dto.operatorId,
      action: 'HERMES_SAFE_MODE_DISABLE',
      resourceType: 'safe_mode',
      resourceId: 'global',
      payload: {
        reason: dto.reason ?? null,
        state,
      },
    });
    return { safeMode: state };
  }

  private async auditMutationResult(
    action: string,
    dto: HermesOperatorMutationDto,
    resourceId: string,
    result: { status: number; json: unknown },
    opts: {
      correlationId?: string;
      extra?: Record<string, unknown>;
    },
  ): Promise<void> {
    await this.audit.appendEntry({
      correlationId: opts.correlationId,
      idempotencyKey: dto.idempotencyKey,
      actor: dto.operatorId,
      action:
        result.status < 400 ? `${action}_OK` : `${action}_HTTP_${result.status}`,
      resourceType: 'hermes_mutation',
      resourceId,
      payload: {
        approveReason: dto.approveReason ?? null,
        httpStatus: result.status,
        ...opts.extra,
      },
    });
  }
}

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
