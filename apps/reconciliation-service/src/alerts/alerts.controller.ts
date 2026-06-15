import { Body, Controller, Get, HttpCode, Post, Query } from '@nestjs/common';

import {
  AlertmanagerAlertDto,
  AlertmanagerWebhookDto,
} from './dto/alertmanager-webhook.dto';
import { AlertIncidentsService } from './alert-incidents.service';

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
  ): Promise<{ items: Awaited<ReturnType<AlertIncidentsService['list']>> }> {
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
}
