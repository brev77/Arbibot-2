import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';

import { AlertmanagerIncidentEntity } from '@arbibot/persistence';

import { AlertIncidentsService } from './alert-incidents.service';
import {
  AlertmanagerAlertDto,
  AlertmanagerWebhookDto,
} from './dto/alertmanager-webhook.dto';
import { UpdateAlertIncidentStatusDto } from './dto/update-alert-incident-status.dto';

@Controller('alerts')
export class AlertsController {
  constructor(private readonly service: AlertIncidentsService) {}

  @Post('webhook')
  @HttpCode(200)
  async webhook(@Body() dto: AlertmanagerWebhookDto): Promise<{
    received: number;
    inserted: number;
    updated: number;
  }> {
    let inserted = 0;
    let updated = 0;
    for (const alert of dto.alerts ?? []) {
      const result = await this.service.ingestAlert(alert);
      if (result.inserted) {
        inserted += 1;
      } else if (result.id !== null) {
        updated += 1;
      }
    }
    return { received: dto.alerts?.length ?? 0, inserted, updated };
  }

  @Get()
  async list(
    @Query('status') status?: string,
  ): Promise<{ items: AlertmanagerIncidentEntity[] }> {
    const items = await this.service.list(status);
    return { items };
  }

  @Post('ingest')
  @HttpCode(200)
  async ingest(@Body() alert: AlertmanagerAlertDto): Promise<{
    inserted: boolean;
    fingerprint: string;
    id: string | null;
  }> {
    return this.service.ingestAlert(alert);
  }

  /**
   * Drill #1 gap #4/#5: canonical list endpoint consumed by the operator UI
   * (`/incidents`) via `apps/web/app/api/operator/alerts/incidents/route.ts`.
   *
   * Returns newest `lastFiredAt` first; optional `?status=open|firing|
   * investigating|resolved` filter.
   */
  @Get('incidents')
  async listIncidents(
    @Query('status') status?: string,
  ): Promise<{ items: AlertmanagerIncidentEntity[] }> {
    const items = await this.service.list(status);
    return { items };
  }

  /**
   * Drill #1 gap #5: operator-driven status transition with optimistic
   * concurrency. Returns the updated incident (new `entityVersion`).
   *
   * HTTP 404 if id is unknown, HTTP 409 on stale `expectedEntityVersion`.
   */
  @Patch('incidents/:id')
  async updateIncidentStatus(
    @Param('id') id: string,
    @Body() dto: UpdateAlertIncidentStatusDto,
  ): Promise<AlertmanagerIncidentEntity> {
    return this.service.setStatus({
      id,
      status: dto.status,
      expectedEntityVersion: dto.expectedEntityVersion,
      resolvedBy: dto.resolvedBy ?? null,
    });
  }
}