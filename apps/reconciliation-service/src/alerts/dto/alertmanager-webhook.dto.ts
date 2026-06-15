import { Type } from 'class-transformer';
import {
  IsArray,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';

/**
 * Alertmanager webhook payload (per-alert, group_summary v2 format).
 * Reference: https://prometheus.io/docs/alerting/latest/configuration/#webhook_config
 */
export class AlertmanagerAlertLabelDto {
  @IsString()
  alertname!: string;

  @IsOptional()
  @IsString()
  severity?: string;

  @IsOptional()
  @IsString()
  instance?: string;

  @IsOptional()
  @IsString()
  job?: string;

  [key: string]: string | undefined;
}

export class AlertmanagerAlertAnnotationDto {
  @IsOptional()
  @IsString()
  summary?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  runbook_url?: string;

  [key: string]: string | undefined;
}

export class AlertmanagerAlertDto {
  @IsString()
  status!: string;

  @IsObject()
  labels!: AlertmanagerAlertLabelDto;

  @IsObject()
  annotations!: AlertmanagerAlertAnnotationDto;

  @IsString()
  startsAt!: string;

  @IsString()
  endsAt!: string;

  @IsOptional()
  @IsString()
  generatorURL?: string;

  @IsString()
  fingerprint!: string;

  @IsOptional()
  @IsString()
  value?: string;
}

/**
 * Standard Alertmanager webhook payload (v4 reference).
 * Reference: https://prometheus.io/docs/alerting/latest/configuration/#webhook_config
 *
 * IMPORTANT: Alertmanager sends `version` and `receiver` as STRINGS,
 * not number/object. `commonLabels`, `commonAnnotations`, and `externalURL`
 * are standard envelope fields and MUST be whitelisted (reconciliation-service
 * uses forbidNonWhitelisted=true global ValidationPipe).
 */
export class AlertmanagerWebhookDto {
  @IsOptional()
  @IsString()
  version?: string;

  @IsOptional()
  @IsString()
  groupKey?: string;

  @IsOptional()
  @IsNumber()
  truncatedAlerts?: number;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  receiver?: string;

  @IsOptional()
  @IsObject()
  groupLabels?: Record<string, string>;

  @IsOptional()
  @IsObject()
  commonLabels?: Record<string, string>;

  @IsOptional()
  @IsObject()
  commonAnnotations?: Record<string, string>;

  @IsOptional()
  @IsString()
  externalURL?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AlertmanagerAlertDto)
  alerts!: AlertmanagerAlertDto[];
}
