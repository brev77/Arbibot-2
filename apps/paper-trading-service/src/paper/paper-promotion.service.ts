import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryFailedError, Repository } from 'typeorm';

import {
  PAPER_PROMOTION_STATUSES,
  type PaperPromotionStatus,
  PaperPromotionCandidateEntity,
} from '@arbibot/persistence';

import type { CreatePromotionCandidateDto } from './dto/create-promotion-candidate.dto';
import type { PatchPromotionCandidateDto } from './dto/patch-promotion-candidate.dto';

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
}
