import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { ScannerFindingEntity } from '@arbibot/persistence';

/**
 * Read/query service for `scanner_findings` (S1-7-API).
 *
 * Findings are WRITTEN by the Phase 2 spread detector (S2-4-INTEGRATE) and the Phase 3 publisher.
 * This service only reads them for the HTTP API (`GET /scanner/findings`, `GET /scanner/findings/:id`)
 * and the future re-publish flow (Phase 3-2). Single-writer invariant: scanner-service owns the
 * table, but the write path arrives in later phases.
 */
@Injectable()
export class ScannerFindingsService {
  private readonly logger = new Logger(ScannerFindingsService.name);

  constructor(
    @InjectRepository(ScannerFindingEntity)
    private readonly repo: Repository<ScannerFindingEntity>,
  ) {}

  /**
   * List findings, optionally filtered by instance / publish-status, newest first.
   * @param instanceId optional instance filter
   * @param publishStatus optional `pending | published | failed` filter
   * @param limit clamped to [1, 500], default 100
   */
  async list(
    instanceId?: string,
    publishStatus?: string,
    limit = 100,
  ): Promise<ScannerFindingEntity[]> {
    const clampedLimit = Math.min(500, Math.max(1, limit));
    const where: Record<string, unknown> = {};
    if (instanceId !== undefined && instanceId.length > 0) {
      where.instanceId = instanceId;
    }
    if (publishStatus !== undefined && publishStatus.length > 0) {
      where.publishStatus = publishStatus;
    }
    return this.repo.find({
      where,
      order: { observedAt: 'DESC' },
      take: clampedLimit,
    });
  }

  /** Get a single finding by id; throws NotFoundException when absent. */
  async getById(id: string): Promise<ScannerFindingEntity> {
    const finding = await this.repo.findOne({ where: { id } });
    if (finding === null) {
      throw new NotFoundException(`Scanner finding ${id} not found`);
    }
    return finding;
  }
}
