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
   *
   * R2 (2026-07-31): `completed_plan_missing_portfolio` skips plans whose every leg was filled on
   * a mock/lab venue (`venue_ref LIKE 'mock:%'`). These are paper/test/burn plans; on the paper
   * stand settlement is gated off (EXECUTION_SETTLEMENT_ENABLED), so they complete without a
   * portfolio row by design. Reporting them as mismatches is a false alarm — real DEX fills use
   * venue refs like `uniswap-v2`, never `mock:`. Additionally, already-open mismatches of this
   * kind whose plan turns out to be mock-only are auto-resolved here (detectors otherwise never
   * close rows, only de-dupe inserts).
   */
  async runDetectors(): Promise<{
    inserted: number;
    byKind: Record<string, number>;
  }> {
    const byKind: Record<string, number> = {};

    // R2: auto-resolve any previously-opened mock-only-plan mismatches before re-detecting,
    // so the false alarm from a prior detector run clears once the mock filter is in place.
    const autoResolved = await this.dataSource.query(
      `
      UPDATE reconciliation_mismatches m
      SET status = 'resolved', entity_version = entity_version + 1, updated_at = now()
      WHERE m.kind = $1::text
        AND m.status = 'open'
        AND EXISTS (
          SELECT 1 FROM execution_plans p
          WHERE p.id::text = (m.details->>'planId')
            AND p.state = 'completed'
            AND EXISTS (SELECT 1 FROM execution_legs l WHERE l.plan_id = p.id)
            AND NOT EXISTS (
              SELECT 1 FROM execution_legs l
              WHERE l.plan_id = p.id AND l.venue_ref NOT LIKE 'mock:%'
            )
        )
      `,
      [MISMATCH_KIND_COMPLETED_PLAN_MISSING_PORTFOLIO],
    );
    const resolvedCount = Array.isArray(autoResolved) ? (autoResolved as { length: number }).length : 0;
    if (resolvedCount > 0) {
      byKind[`${MISMATCH_KIND_COMPLETED_PLAN_MISSING_PORTFOLIO}__auto_resolved_mock`] = resolvedCount;
    }

    const a = await this.insertDetectorRows(
      MISMATCH_KIND_COMPLETED_PLAN_MISSING_PORTFOLIO,
      `
      SELECT p.id
      FROM execution_plans p
      WHERE p.state = 'completed'
        AND NOT EXISTS (SELECT 1 FROM portfolio_positions pp WHERE pp.plan_id = p.id)
        -- R2: skip mock/lab-venue plans (paper/test/burn). Real DEX legs use venue refs like
        -- 'uniswap-v2'; only test harnesses use 'mock:'. They complete without a portfolio row
        -- by design on the paper stand (settlement gated off), so they are not real mismatches.
        AND EXISTS (SELECT 1 FROM execution_legs l WHERE l.plan_id = p.id)
        AND EXISTS (
          SELECT 1 FROM execution_legs l
          WHERE l.plan_id = p.id AND l.venue_ref NOT LIKE 'mock:%'
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

    return { inserted: a + b + dexResult.inserted + resolvedCount, byKind };
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
