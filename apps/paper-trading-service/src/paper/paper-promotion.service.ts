import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, QueryFailedError, Repository } from 'typeorm';

import {
  PAPER_PROMOTION_STATUSES,
  type PaperPromotionStatus,
  PaperPromotionCandidateEntity,
} from '@arbibot/persistence';
import { AuditClientService, type AuditRecordInput } from '@arbibot/nest-platform';

import type { CreatePromotionCandidateDto } from './dto/create-promotion-candidate.dto';
import type { PatchPromotionCandidateDto } from './dto/patch-promotion-candidate.dto';

/** PRIO-P2-PROMO: deterministic quality signal from score + drift for operator UI. */
export function promotionQualityFor(row: PaperPromotionCandidateEntity): {
  readonly tier: 'high' | 'medium' | 'low';
  readonly score: number;
} {
  const rawScore = row.score !== null ? Number(row.score) : 0;
  const drift = row.driftBps !== null ? Math.abs(Number(row.driftBps)) : 0;
  const driftPenalty = Math.min(drift / 100, 2);
  const score = Math.max(0, Math.min(10, rawScore + 2 - driftPenalty));
  let tier: 'high' | 'medium' | 'low' = 'low';
  if (score >= 7) {
    tier = 'high';
  } else if (score >= 4) {
    tier = 'medium';
  }
  return { tier, score: Math.round(score * 1000) / 1000 };
}

const ALLOWED: Record<
  PaperPromotionStatus,
  readonly PaperPromotionStatus[]
> = {
  queued: ['under_review', 'rejected', 'expired'],
  under_review: ['promoted', 'rejected'],
  promoted: [],
  rejected: [],
  expired: [],
};

function assertTransition(from: PaperPromotionStatus, to: PaperPromotionStatus): void {
  if (!ALLOWED[from].includes(to)) {
    throw new ConflictException(`Invalid promotion transition ${from} → ${to}`);
  }
}

function isUniqueViolation(err: unknown): boolean {
  if (err instanceof QueryFailedError) {
    const code = (err.driverError as { code?: string } | undefined)?.code;
    return code === '23505';
  }
  return (err as { code?: string } | undefined)?.code === '23505';
}

@Injectable()
export class PaperPromotionService {
  constructor(
    @InjectRepository(PaperPromotionCandidateEntity)
    private readonly repo: Repository<PaperPromotionCandidateEntity>,
    private readonly auditClient: AuditClientService,
  ) {}

  async list(status?: string): Promise<PaperPromotionCandidateEntity[]> {
    if (
      status !== undefined &&
      status.length > 0 &&
      !PAPER_PROMOTION_STATUSES.includes(status as PaperPromotionStatus)
    ) {
      throw new BadRequestException(`Invalid status filter: ${status}`);
    }
    const where =
      status !== undefined && status.length > 0 ? { status: status as PaperPromotionStatus } : {};
    return this.repo.find({
      where,
      order: { updatedAt: 'DESC' },
      take: 200,
    });
  }

  async create(dto: CreatePromotionCandidateDto): Promise<PaperPromotionCandidateEntity> {
    const idem = dto.enqueueIdempotencyKey?.trim();
    if (idem !== undefined && idem.length > 0) {
      const existing = await this.repo.findOne({
        where: { enqueueIdempotencyKey: idem },
      });
      if (existing !== null) {
        return existing;
      }
    }

    const score =
      dto.score !== undefined && !Number.isNaN(dto.score) ? String(dto.score) : null;
    const driftBps =
      dto.driftBps !== undefined && !Number.isNaN(dto.driftBps)
        ? String(dto.driftBps)
        : null;
    const row = this.repo.create({
      instrumentKey: dto.instrumentKey,
      opportunityId: dto.opportunityId ?? null,
      source: dto.source ?? 'paper_discovery',
      status: 'queued',
      score,
      driftBps,
      evidence: dto.evidence ?? {},
      entityVersion: 1,
      enqueueIdempotencyKey: idem !== undefined && idem.length > 0 ? idem : null,
    });
    try {
      return await this.repo.save(row);
    } catch (err: unknown) {
      if (idem !== undefined && idem.length > 0 && isUniqueViolation(err)) {
        const replay = await this.repo.findOne({
          where: { enqueueIdempotencyKey: idem },
        });
        if (replay !== null) {
          return replay;
        }
      }
      throw err;
    }
  }

  async patch(
    id: string,
    dto: PatchPromotionCandidateDto,
  ): Promise<PaperPromotionCandidateEntity> {
    return this.repo.manager.transaction(async (em) => {
      const row = await em.findOne(PaperPromotionCandidateEntity, {
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });
      if (row === null) {
        throw new NotFoundException(`Promotion candidate not found: ${id}`);
      }
      if (row.entityVersion !== dto.expectedVersion) {
        throw new ConflictException(
          `Version mismatch: expected ${dto.expectedVersion}, got ${row.entityVersion}`,
        );
      }
      assertTransition(row.status, dto.status);
      row.status = dto.status;
      row.entityVersion += 1;
      return em.save(PaperPromotionCandidateEntity, row);
    });
  }

  /** Read model for promotion automation (PRIO-P2-PROMO). */
  getPromotionCriteria(): {
    maxDriftBps: number;
    minScore: number | null;
    description: string;
  } {
    const rawMax = Number(process.env.PAPER_PROMOTION_MAX_DRIFT_BPS ?? '50');
    const maxDriftBps = Number.isFinite(rawMax) ? rawMax : 50;
    const minRaw = process.env.PAPER_PROMOTION_MIN_SCORE?.trim();
    const minScore =
      minRaw !== undefined &&
      minRaw.length > 0 &&
      !Number.isNaN(Number(minRaw))
        ? Number(minRaw)
        : null;
    return {
      maxDriftBps,
      minScore,
      description:
        'Gates: when drift_bps is set it must be <= maxDriftBps; when minScore is set, score must be >= minScore.',
    };
  }

  /** Whether a row satisfies documented gates (helper for operators / UI). */
  evaluatePromotionEligibility(row: {
    driftBps: string | null;
    score: string | null;
  }): { ok: boolean; reasons: string[] } {
    const crit = this.getPromotionCriteria();
    const reasons: string[] = [];
    if (row.driftBps !== null && row.driftBps !== undefined) {
      const d = Number(row.driftBps);
      if (Number.isFinite(d) && d > crit.maxDriftBps) {
        reasons.push(`drift_bps ${d} exceeds max ${crit.maxDriftBps}`);
      }
    }
    if (crit.minScore !== null) {
      const s = row.score === null ? NaN : Number(row.score);
      if (!Number.isFinite(s) || s < crit.minScore) {
        reasons.push(`score below minimum ${crit.minScore}`);
      }
    }
    return { ok: reasons.length === 0, reasons };
  }

  async approve(id: string, operatorId: string): Promise<PaperPromotionCandidateEntity> {
    const before = await this.repo.findOne({ where: { id } });
    if (before === null) {
      throw new NotFoundException(`Promotion candidate not found: ${id}`);
    }
    if (before.status !== 'queued' && before.status !== 'under_review') {
      throw new BadRequestException(
        `Cannot approve promotion candidate in state ${before.status}`,
      );
    }

    // Check eligibility before approving
    const eligibility = this.evaluatePromotionEligibility({
      driftBps: before.driftBps,
      score: before.score,
    });
    if (!eligibility.ok) {
      throw new BadRequestException(
        `Candidate not eligible for promotion: ${eligibility.reasons.join(', ')}`,
      );
    }

    const after = await this.patch(id, {
      expectedVersion: before.entityVersion,
      status: 'promoted',
    });

    const auditInput: AuditRecordInput = {
      actor: operatorId,
      action: 'paper_promotion_candidate_approved',
      resourceType: 'PaperPromotionCandidate',
      resourceId: id,
      payload: {
        instrumentKey: before.instrumentKey,
        opportunityId: before.opportunityId,
        score: before.score,
        driftBps: before.driftBps,
        fromState: before.status,
        toState: after.status,
      },
    };
    void this.auditClient.appendEntry(auditInput).catch((err) => {
      console.error(`Failed to record audit for promotion candidate approve: ${err}`);
    });

    return after;
  }

  async reject(id: string, operatorId: string): Promise<PaperPromotionCandidateEntity> {
    const before = await this.repo.findOne({ where: { id } });
    if (before === null) {
      throw new NotFoundException(`Promotion candidate not found: ${id}`);
    }
    if (before.status !== 'queued' && before.status !== 'under_review') {
      throw new BadRequestException(
        `Cannot reject promotion candidate in state ${before.status}`,
      );
    }

    const after = await this.patch(id, {
      expectedVersion: before.entityVersion,
      status: 'rejected',
    });

    const auditInput: AuditRecordInput = {
      actor: operatorId,
      action: 'paper_promotion_candidate_rejected',
      resourceType: 'PaperPromotionCandidate',
      resourceId: id,
      payload: {
        instrumentKey: before.instrumentKey,
        opportunityId: before.opportunityId,
        fromState: before.status,
        toState: after.status,
      },
    };
    void this.auditClient.appendEntry(auditInput).catch((err) => {
      console.error(`Failed to record audit for promotion candidate reject: ${err}`);
    });

    return after;
  }

  /**
   * Persist quality snapshot for queued / under_review rows (worker).
   * Returns number of rows updated.
   */
  async refreshPersistedQualitySnapshots(): Promise<number> {
    const rows = await this.repo.find({
      where: { status: In(['queued', 'under_review'] as const) },
      take: 500,
      order: { updatedAt: 'ASC' },
    });
    let n = 0;
    for (const row of rows) {
      const q = promotionQualityFor(row);
      await this.repo.update(
        { id: row.id },
        {
          qualityScore: String(q.score),
          qualityTier: q.tier,
        },
      );
      n += 1;
    }
    return n;
  }
}
