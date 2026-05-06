import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';

import { ReconciliationMismatchEntity } from '@arbibot/persistence';

import { runDexDetectors } from './dex-reconciliation.detectors';
import type { UpdateMismatchStatusDto } from './dto/update-mismatch-status.dto';

/** Completed execution plan with no portfolio row (settlement gap / detector seed). */
export const MISMATCH_KIND_COMPLETED_PLAN_MISSING_PORTFOLIO =
  'completed_plan_missing_portfolio' as const;

/** Plan still executing while every leg is filled (orchestrator completion gap). */
export const MISMATCH_KIND_EXECUTING_LEGS_FILLED_PLAN_NOT_COMPLETED =
  'executing_plan_legs_filled_not_completed' as const;

@Injectable()
export class MismatchesService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(ReconciliationMismatchEntity)
    private readonly repo: Repository<ReconciliationMismatchEntity>,
  ) {}

  async list(): Promise<ReconciliationMismatchEntity[]> {
    return this.repo.find({
      order: { createdAt: 'DESC' },
      take: 200,
    });
  }

  async updateStatus(
    id: string,
    dto: UpdateMismatchStatusDto,
  ): Promise<ReconciliationMismatchEntity> {
    return this.dataSource.transaction(async (em) => {
      const row = await em.findOne(ReconciliationMismatchEntity, {
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });
      if (row === null) {
        throw new NotFoundException(`Mismatch not found: ${id}`);
      }
      if (
        dto.expectedEntityVersion !== undefined &&
        dto.expectedEntityVersion !== row.entityVersion
      ) {
        throw new ConflictException(
          `Mismatch ${id} version mismatch: expected ${dto.expectedEntityVersion}, actual ${row.entityVersion}`,
        );
      }
      row.status = dto.status;
      row.entityVersion += 1;
      return em.save(row);
    });
  }

  /**
   * Runs SQL detectors (bounded inserts). Idempotent per plan/kind for open rows.
   */
  async runDetectors(): Promise<{
    inserted: number;
    byKind: Record<string, number>;
  }> {
    const byKind: Record<string, number> = {};

    const a = await this.insertDetectorRows(
      MISMATCH_KIND_COMPLETED_PLAN_MISSING_PORTFOLIO,
      `
      SELECT p.id
      FROM execution_plans p
      WHERE p.state = 'completed'
        AND NOT EXISTS (SELECT 1 FROM portfolio_positions pp WHERE pp.plan_id = p.id)
        AND NOT EXISTS (
          SELECT 1 FROM reconciliation_mismatches m
          WHERE m.kind = $1::text
            AND m.status = 'open'
            AND (m.details->>'planId') = p.id::text
        )
      LIMIT 10
      `,
    );
    byKind[MISMATCH_KIND_COMPLETED_PLAN_MISSING_PORTFOLIO] = a;

    const b = await this.insertDetectorRows(
      MISMATCH_KIND_EXECUTING_LEGS_FILLED_PLAN_NOT_COMPLETED,
      `
      SELECT p.id
      FROM execution_plans p
      WHERE p.state = 'executing'
        AND EXISTS (SELECT 1 FROM execution_legs l WHERE l.plan_id = p.id)
        AND NOT EXISTS (
          SELECT 1 FROM execution_legs l
          WHERE l.plan_id = p.id AND l.state <> 'filled'
        )
        AND NOT EXISTS (
          SELECT 1 FROM reconciliation_mismatches m
          WHERE m.kind = $1::text
            AND m.status = 'open'
            AND (m.details->>'planId') = p.id::text
        )
      LIMIT 10
      `,
    );
    byKind[MISMATCH_KIND_EXECUTING_LEGS_FILLED_PLAN_NOT_COMPLETED] = b;

    // DEX-specific detectors (DEX-1-2-RECON-ONCHAIN)
    const dexResult = await runDexDetectors(this.dataSource);
    for (const [kind, count] of Object.entries(dexResult.byKind)) {
      byKind[kind] = count;
    }

    return { inserted: a + b + dexResult.inserted, byKind };
  }

  private async insertDetectorRows(
    kind: string,
    planSelectSql: string,
  ): Promise<number> {
    const rows: unknown = await this.dataSource.query(
      `
      INSERT INTO reconciliation_mismatches (kind, status, details, entity_version)
      SELECT $1::text, 'open', jsonb_build_object('planId', s.id::text), 1
      FROM (${planSelectSql}) AS s(id)
      RETURNING id
      `,
      [kind],
    );
    return Array.isArray(rows) ? rows.length : 0;
  }
}
