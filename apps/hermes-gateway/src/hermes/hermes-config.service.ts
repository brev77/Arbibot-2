import { HttpException, HttpStatus, Injectable } from '@nestjs/common';

import { AuditClientService } from '@arbibot/nest-platform';

import { assertConfigKeyAllowed } from './config-allowlist';
import {
  ConfigPromoteDto,
  ConfigRollbackDto,
  ConfigStatusDto,
  ConfigUpdateDto,
} from './dto/config-mutation.dto';
import { getConfigApiBase } from './hermes-env';
import { asExceptionBody } from './http-error';
import { HermesUpstreamService } from './hermes-upstream.service';

/**
 * Proxies Hermes config-management requests to config-service
 * (`/policy/configurations/*`). Plan 6 (H6-B-3).
 *
 * Mutations are gated by `assertConfigKeyAllowed` (allowlist of non-sensitive
 * key patterns — see docs/adr-hermes-config-management.md). Every mutation is
 * audited with `resourceType: 'policy_configuration'` and action suffix
 * `_OK` / `_HTTP_<n>` mirroring `HermesMutationService.auditMutationResult`.
 */
@Injectable()
export class HermesConfigService {
  constructor(
    private readonly upstream: HermesUpstreamService,
    private readonly audit: AuditClientService,
  ) {}

  /** PUT /policy/configurations/:configKey — create new version. */
  async updateConfig(
    configKey: string,
    dto: ConfigUpdateDto,
    correlationId?: string,
  ): Promise<unknown> {
    assertConfigKeyAllowed(configKey);
    const base = getConfigApiBase();
    const body: Record<string, unknown> = {
      configValue: dto.configValue,
      operatorId: dto.operatorId,
    };
    if (dto.scopeType !== undefined) body.scopeType = dto.scopeType;
    if (dto.scopeValue !== undefined) body.scopeValue = dto.scopeValue;
    if (dto.status !== undefined) body.status = dto.status;
    if (dto.approveReason !== undefined) body.approveReason = dto.approveReason;

    const result = await this.upstream.putJson(
      `${base}/policy/configurations/${encodeURIComponent(configKey)}`,
      body,
      correlationId,
    );
    await this.auditConfigResult(
      'HERMES_CONFIG_UPDATE',
      configKey,
      dto,
      result,
      correlationId,
      { scopeType: dto.scopeType, scopeValue: dto.scopeValue },
    );
    if (result.status >= 400) {
      throw new HttpException(
        asExceptionBody(result.json),
        result.status >= 500 ? HttpStatus.BAD_GATEWAY : result.status,
      );
    }
    return result.json;
  }

  /** POST /policy/configurations/:configKey/rollback — restore a prior version. */
  async rollbackConfig(
    configKey: string,
    dto: ConfigRollbackDto,
    correlationId?: string,
  ): Promise<unknown> {
    assertConfigKeyAllowed(configKey);
    const base = getConfigApiBase();
    const body: Record<string, unknown> = {
      toVersion: dto.toVersion,
      operatorId: dto.operatorId,
    };
    if (dto.scopeType !== undefined) body.scopeType = dto.scopeType;
    if (dto.scopeValue !== undefined) body.scopeValue = dto.scopeValue;
    if (dto.approveReason !== undefined) body.approveReason = dto.approveReason;

    const result = await this.upstream.postJson(
      `${base}/policy/configurations/${encodeURIComponent(configKey)}/rollback`,
      body,
      correlationId,
    );
    await this.auditConfigResult(
      'HERMES_CONFIG_ROLLBACK',
      configKey,
      dto,
      result,
      correlationId,
      { toVersion: dto.toVersion },
    );
    if (result.status >= 400) {
      throw new HttpException(
        asExceptionBody(result.json),
        result.status >= 500 ? HttpStatus.BAD_GATEWAY : result.status,
      );
    }
    return result.json;
  }

  /** POST /policy/configurations/:configKey/promote — copy active row across scopes. */
  async promoteConfig(
    configKey: string,
    dto: ConfigPromoteDto,
    correlationId?: string,
  ): Promise<unknown> {
    assertConfigKeyAllowed(configKey);
    const base = getConfigApiBase();
    const body: Record<string, unknown> = {
      fromScopeType: dto.fromScopeType,
      toScopeType: dto.toScopeType,
      operatorId: dto.operatorId,
    };
    if (dto.fromScopeValue !== undefined) body.fromScopeValue = dto.fromScopeValue;
    if (dto.toScopeValue !== undefined) body.toScopeValue = dto.toScopeValue;
    if (dto.approveReason !== undefined) body.approveReason = dto.approveReason;
    if (dto.idempotencyKey !== undefined) body.idempotencyKey = dto.idempotencyKey;

    const result = await this.upstream.postJson(
      `${base}/policy/configurations/${encodeURIComponent(configKey)}/promote`,
      body,
      correlationId,
    );
    await this.auditConfigResult(
      'HERMES_CONFIG_PROMOTE',
      configKey,
      dto,
      result,
      correlationId,
      { fromScopeType: dto.fromScopeType, toScopeType: dto.toScopeType },
    );
    if (result.status >= 400) {
      throw new HttpException(
        asExceptionBody(result.json),
        result.status >= 500 ? HttpStatus.BAD_GATEWAY : result.status,
      );
    }
    return result.json;
  }

  /** PATCH /policy/configurations/:configKey/status — activate latest draft. */
  async activateConfig(
    configKey: string,
    dto: ConfigStatusDto,
    correlationId?: string,
  ): Promise<unknown> {
    assertConfigKeyAllowed(configKey);
    const base = getConfigApiBase();
    const body: Record<string, unknown> = {
      status: dto.status,
      operatorId: dto.operatorId,
    };
    if (dto.scopeType !== undefined) body.scopeType = dto.scopeType;
    if (dto.scopeValue !== undefined) body.scopeValue = dto.scopeValue;
    if (dto.approveReason !== undefined) body.approveReason = dto.approveReason;

    const result = await this.upstream.patchJson(
      `${base}/policy/configurations/${encodeURIComponent(configKey)}/status`,
      body,
      correlationId,
    );
    await this.auditConfigResult(
      'HERMES_CONFIG_STATUS',
      configKey,
      dto,
      result,
      correlationId,
      { status: dto.status },
    );
    if (result.status >= 400) {
      throw new HttpException(
        asExceptionBody(result.json),
        result.status >= 500 ? HttpStatus.BAD_GATEWAY : result.status,
      );
    }
    return result.json;
  }

  private async auditConfigResult(
    action: string,
    configKey: string,
    dto: { operatorId: string; approveReason?: string; idempotencyKey?: string },
    result: { status: number; json: unknown },
    correlationId: string | undefined,
    extra: Record<string, unknown>,
  ): Promise<void> {
    await this.audit.appendEntry({
      correlationId,
      idempotencyKey: dto.idempotencyKey,
      actor: dto.operatorId,
      action:
        result.status < 400 ? `${action}_OK` : `${action}_HTTP_${result.status}`,
      resourceType: 'policy_configuration',
      resourceId: configKey,
      payload: {
        approveReason: dto.approveReason ?? null,
        httpStatus: result.status,
        ...extra,
      },
    });
  }
}
