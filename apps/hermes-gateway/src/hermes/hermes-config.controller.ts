import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';

import { HermesAuthGuard } from './hermes-auth.guard';
import {
  ConfigPromoteDto,
  ConfigRollbackDto,
  ConfigStatusDto,
  ConfigUpdateDto,
} from './dto/config-mutation.dto';
import { getConfigApiBase } from './hermes-env';
import { HermesMutationRateLimitGuard } from './hermes-mutation-rate-limit.guard';
import { HermesConfigService } from './hermes-config.service';
import { HermesUpstreamService } from './hermes-upstream.service';
import { asExceptionBody } from './http-error';

type ReqWithCorr = { correlationId?: string };

function getCorrelationId(req: ReqWithCorr): string | undefined {
  return typeof req.correlationId === 'string' && req.correlationId.length > 0
    ? req.correlationId
    : undefined;
}

/**
 * Read-only proxy to config-service `/policy/configurations/*`.
 * Reads are NOT allowlist-restricted — operators may inspect any key, including
 * sensitive ones (read is non-destructive). Plan 6 (H6-B-3).
 */
@Controller('hermes/v1/config')
@UseGuards(HermesAuthGuard)
export class HermesConfigReadController {
  constructor(private readonly upstream: HermesUpstreamService) {}

  /** GET /hermes/v1/config — list configurations (query: scopeType, scopeValue). */
  @Get()
  async list(
    @Req() req: ReqWithCorr,
    @Query('scopeType') scopeType?: string,
    @Query('scopeValue') scopeValue?: string,
  ): Promise<unknown> {
    return this.proxyGet('', req, { scopeType, scopeValue });
  }

  /** GET /hermes/v1/config/:configKey — single key (query: scopeType, scopeValue). */
  @Get(':configKey')
  async getByKey(
    @Req() req: ReqWithCorr,
    @Param('configKey') configKey: string,
    @Query('scopeType') scopeType?: string,
    @Query('scopeValue') scopeValue?: string,
  ): Promise<unknown> {
    return this.proxyGet(`/${encodeURIComponent(configKey)}`, req, {
      scopeType,
      scopeValue,
    });
  }

  /** GET /hermes/v1/config/:configKey/effective — resolved value with scope fallback. */
  @Get(':configKey/effective')
  async getEffective(
    @Req() req: ReqWithCorr,
    @Param('configKey') configKey: string,
    @Query('environment') environment?: string,
    @Query('tenantId') tenantId?: string,
  ): Promise<unknown> {
    return this.proxyGet(`/${encodeURIComponent(configKey)}/effective`, req, {
      environment,
      tenantId,
    });
  }

  /** GET /hermes/v1/config/:configKey/history — version history per scope. */
  @Get(':configKey/history')
  async getHistory(
    @Req() req: ReqWithCorr,
    @Param('configKey') configKey: string,
    @Query('scopeType') scopeType?: string,
    @Query('scopeValue') scopeValue?: string,
  ): Promise<unknown> {
    return this.proxyGet(`/${encodeURIComponent(configKey)}/history`, req, {
      scopeType,
      scopeValue,
    });
  }

  private async proxyGet(
    suffix: string,
    req: ReqWithCorr,
    query: Record<string, string | undefined>,
  ): Promise<unknown> {
    const base = getConfigApiBase();
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== '') qs.set(k, v);
    }
    const url = qs.toString().length > 0
      ? `${base}/policy/configurations${suffix}?${qs.toString()}`
      : `${base}/policy/configurations${suffix}`;
    const result = await this.upstream.getJson(url, getCorrelationId(req));
    if (result.status >= 400) {
      throw new HttpException(
        asExceptionBody(result.json),
        result.status >= 500 ? HttpStatus.BAD_GATEWAY : result.status,
      );
    }
    return result.json;
  }
}

/**
 * Mutation proxy to config-service. Stacked guards: API key auth + per-key
 * mutation rate limit. `HermesConfigService` additionally enforces the
 * config-key allowlist before forwarding (403 for sensitive keys).
 */
@Controller('hermes/v1/config')
@UseGuards(HermesAuthGuard, HermesMutationRateLimitGuard)
export class HermesConfigMutationController {
  constructor(private readonly config: HermesConfigService) {}

  /** PUT /hermes/v1/config/:configKey — create new version with value. */
  @Put(':configKey')
  @HttpCode(HttpStatus.OK)
  async update(
    @Req() req: ReqWithCorr,
    @Param('configKey') configKey: string,
    @Body() body: ConfigUpdateDto,
  ): Promise<unknown> {
    return this.config.updateConfig(configKey, body, getCorrelationId(req));
  }

  /** POST /hermes/v1/config/:configKey/rollback — restore a prior version. */
  @Post(':configKey/rollback')
  @HttpCode(HttpStatus.OK)
  async rollback(
    @Req() req: ReqWithCorr,
    @Param('configKey') configKey: string,
    @Body() body: ConfigRollbackDto,
  ): Promise<unknown> {
    return this.config.rollbackConfig(configKey, body, getCorrelationId(req));
  }

  /** POST /hermes/v1/config/:configKey/promote — copy active row across scopes. */
  @Post(':configKey/promote')
  @HttpCode(HttpStatus.OK)
  async promote(
    @Req() req: ReqWithCorr,
    @Param('configKey') configKey: string,
    @Body() body: ConfigPromoteDto,
  ): Promise<unknown> {
    return this.config.promoteConfig(configKey, body, getCorrelationId(req));
  }

  /** PATCH /hermes/v1/config/:configKey/status — activate latest draft. */
  @Patch(':configKey/status')
  @HttpCode(HttpStatus.OK)
  async activate(
    @Req() req: ReqWithCorr,
    @Param('configKey') configKey: string,
    @Body() body: ConfigStatusDto,
  ): Promise<unknown> {
    return this.config.activateConfig(configKey, body, getCorrelationId(req));
  }
}
