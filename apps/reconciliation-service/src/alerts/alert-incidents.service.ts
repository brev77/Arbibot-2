import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';

import { AlertmanagerIncidentEntity } from '@arbibot/persistence';

import {
  AlertIncidentNotFoundError,
  AlertIncidentVersionMismatchError,
} from './alert-incidents.errors';
import type { AlertmanagerAlertDto } from './dto/alertmanager-webhook.dto';

/**
 * Drill #1 gap #1: surface Prometheus/Alertmanager alerts in `/incidents`.
 *
 * Single-writer for `alertmanager_incidents` rows. Two state families:
 * - `firing` / `resolved_external` (webhook-driven, set by Alertmanager)
 * - `investigating` / `resolved` (operator-driven via PATCH)
 *
 * Re-opening is idempotent: a re-fire on `resolved_external` moves the row
 * back to `firing` and clears the resolved metadata. A `resolved` webhook
 * arriving while an operator is `investigating` is a no-op so operator work
 * is never silently cleared by Alertmanager.
 */
@Injectable()
export class AlertIncidentsService {
  private readonly logger = new Logger(AlertIncidentsService.name);
  private static readonly LIST_LIMIT = 200;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(AlertmanagerIncidentEntity)
    private readonly repo: Repository<AlertmanagerIncidentEntity>,
  ) {}

  /**
   * Ingest one alert from an Alertmanager webhook. Returns whether a new row
   * was inserted (true) or an existing row was updated (false).
   */
  async ingestAlert(
    alert: AlertmanagerAlertDto,
  ): Promise<{ inserted: boolean; fingerprint: string; id: string | null }> {
    const fingerprint = alert.fingerprint;
    const status = alert.status === 'resolved' ? 'resolved' : 'firing';
    const severity = this.normalizeSeverity(alert.labels?.severity);
    const alertName = alert.labels?.alertname ?? 'UnknownAlert';
    const summary = alert.annotations?.summary ?? null;
    const description = alert.annotations?.description ?? null;
    const startsAt = this.tryParseDate(alert.startsAt);
    const endsAt = this.tryParseDate(alert.endsAt);

    return this.dataSource.transaction(async (em) => {
      const existing = await em.findOne(AlertmanagerIncidentEntity, {
        where: { fingerprint },
      });

      if (!existing) {
        if (status === 'resolved') {
          this.logger.debug(
            `Resolved webhook for unknown fingerprint=${fingerprint}; ignoring`,
          );
          return { inserted: false, fingerprint, id: null };
        }

        const values: Partial<AlertmanagerIncidentEntity> = {
          alertName,
          severity,
          status: 'firing',
          fingerprint,
          summary,
          description,
          payload: {
            labels: alert.labels ?? {},
            annotations: alert.annotations ?? {},
            generatorURL: alert.generatorURL ?? null,
            value: alert.value ?? null,
          },
          startsAt,
          endsAt,
          lastFiredAt: new Date(),
        };
        const created = em.create(AlertmanagerIncidentEntity, values);
        const saved = await em.save(created);
        return { inserted: true, fingerprint, id: saved.id };
      }

      if (status === 'resolved') {
        if (existing.status === 'investigating' || existing.status === 'resolved') {
          this.logger.debug(
            `Resolved webhook for fingerprint=${fingerprint} in status=${existing.status}; keeping operator state`,
          );
          return { inserted: false, fingerprint, id: existing.id };
        }
        existing.status = 'resolved_external';
        existing.endsAt = endsAt ?? existing.endsAt;
        existing.resolvedAt = new Date();
      } else {
        existing.status = 'firing';
        existing.lastFiredAt = new Date();
        existing.startsAt = startsAt ?? existing.startsAt;
        existing.endsAt = endsAt ?? existing.endsAt;
        existing.resolvedAt = null;
        existing.resolvedBy = null;
      }

      existing.summary = summary ?? existing.summary;
      existing.description = description ?? existing.description;
      existing.payload = {
        ...existing.payload,
        labels: alert.labels ?? {},
        annotations: alert.annotations ?? {},
        generatorURL: alert.generatorURL ?? null,
        value: alert.value ?? null,
      };
      existing.entityVersion += 1;

      const saved = await em.save(existing);
      return { inserted: false, fingerprint, id: saved.id };
    });
  }

  /**
   * List incidents, optionally filtered by status. Newest `lastFiredAt` first.
   */
  async list(status?: string): Promise<AlertmanagerIncidentEntity[]> {
    const where = status ? { status } : {};
    return this.repo.find({
      where,
      order: { lastFiredAt: 'DESC' },
      take: AlertIncidentsService.LIST_LIMIT,
    });
  }

  /**
   * Operator-driven status transition (Drill #1 gap #5).
   *
   * Allowed transitions:
   *   - `investigating`: any current status → `investigating`
   *   - `resolved`:      any current status → `resolved` (sets resolvedAt/resolvedBy)
   *
   * Single-writer: this service (reconciliation-service). Optimistic concurrency
   * via `expectedEntityVersion` (compare-and-set, like reconciliation_mismatches).
   * Returns the updated row or throws if version mismatch / not found.
   */
  async setStatus(params: {
    id: string;
    status: 'investigating' | 'resolved';
    expectedEntityVersion: number;
    resolvedBy?: string | null;
  }): Promise<AlertmanagerIncidentEntity> {
    const targetStatus = params.status;
    const now = new Date();

    return this.dataSource.transaction(async (em) => {
      const existing = await em.findOne(AlertmanagerIncidentEntity, {
        where: { id: params.id },
      });
      if (!existing) {
        throw new AlertIncidentNotFoundError(params.id);
      }
      if (existing.entityVersion !== params.expectedEntityVersion) {
        throw new AlertIncidentVersionMismatchError(
          params.id,
          params.expectedEntityVersion,
          existing.entityVersion,
        );
      }

      existing.status = targetStatus;
      existing.entityVersion += 1;
      if (targetStatus === 'resolved') {
        existing.resolvedAt = now;
        existing.resolvedBy = params.resolvedBy ?? null;
        existing.endsAt = existing.endsAt ?? now;
      } else {
        // moving to `investigating` clears any stale resolution metadata
        existing.resolvedAt = null;
        existing.resolvedBy = null;
      }

      const saved = await em.save(existing);
      this.logger.log(
        `Alert incident ${params.id} status -> ${targetStatus} by ${params.resolvedBy ?? 'operator'} (v${saved.entityVersion})`,
      );
      return saved;
    });
  }

  private normalizeSeverity(raw: string | undefined): string {
    const v = (raw ?? 'warning').toLowerCase();
    if (v === 'critical' || v === 'error' || v === 'severe') {
      return 'critical';
    }
    if (v === 'info' || v === 'debug') {
      return 'info';
    }
    return 'warning';
  }

  private tryParseDate(value: string | undefined): Date | null {
    if (!value || value.startsWith('0001-01-01')) {
      return null;
    }
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
}