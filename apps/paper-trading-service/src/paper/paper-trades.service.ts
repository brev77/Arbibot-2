import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryFailedError, Repository } from 'typeorm';

import { PaperTradeEntity, type PaperTradeState } from '@arbibot/persistence';

import type { CreatePaperTradeDto } from './dto/create-paper-trade.dto';
import type { PatchPaperTradeDto } from './dto/patch-paper-trade.dto';

/** Minimal lifecycle: draft → active → settled | canceled; active → canceled. */
const TRADE_STATE_ALLOWED: Record<
  PaperTradeState,
  readonly PaperTradeState[]
> = {
  draft: ['active', 'canceled'],
  active: ['settled', 'canceled'],
  settled: [],
  canceled: [],
};

function assertTradeStateTransition(from: PaperTradeState, to: PaperTradeState): void {
  if (!TRADE_STATE_ALLOWED[from].includes(to)) {
    throw new ConflictException(`Invalid paper trade transition ${from} → ${to}`);
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
export class PaperTradesService {
  constructor(
    @InjectRepository(PaperTradeEntity)
    private readonly repo: Repository<PaperTradeEntity>,
  ) {}

  async list(): Promise<PaperTradeEntity[]> {
    return this.repo.find({ order: { updatedAt: 'DESC' }, take: 200 });
  }

  async getById(id: string): Promise<PaperTradeEntity | null> {
    return this.repo.findOne({ where: { id } });
  }

  async create(dto: CreatePaperTradeDto): Promise<PaperTradeEntity> {
    if (dto.idempotencyKey !== undefined) {
      const existing = await this.repo.findOne({
        where: { idempotencyKey: dto.idempotencyKey },
      });
      if (existing !== null) {
        return existing;
      }
    }

    const row = this.repo.create({
      opportunityId: dto.opportunityId ?? null,
      instrumentKey: dto.instrumentKey,
      routeKey: dto.routeKey ?? null,
      state: 'draft',
      notional: dto.notional ?? '0',
      summary: dto.summary ?? {},
      entityVersion: 1,
      idempotencyKey: dto.idempotencyKey ?? null,
    });

    try {
      return await this.repo.save(row);
    } catch (err: unknown) {
      if (dto.idempotencyKey !== undefined && isUniqueViolation(err)) {
        const replay = await this.repo.findOne({
          where: { idempotencyKey: dto.idempotencyKey },
        });
        if (replay !== null) {
          return replay;
        }
      }
      throw err;
    }
  }

  async patch(id: string, dto: PatchPaperTradeDto): Promise<PaperTradeEntity> {
    return this.repo.manager.transaction(async (em) => {
      const row = await em.findOne(PaperTradeEntity, {
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });
      if (row === null) {
        throw new NotFoundException(`Paper trade not found: ${id}`);
      }
      if (row.entityVersion !== dto.expectedVersion) {
        throw new ConflictException(
          `Version mismatch: expected ${dto.expectedVersion}, got ${row.entityVersion}`,
        );
      }
      if (dto.state === undefined && dto.notional === undefined) {
        throw new BadRequestException('Provide state and/or notional to patch');
      }
      if (dto.state !== undefined) {
        assertTradeStateTransition(row.state, dto.state);
        row.state = dto.state;
      }
      if (dto.notional !== undefined) {
        row.notional = dto.notional;
      }
      row.entityVersion += 1;
      return em.save(PaperTradeEntity, row);
    });
  }
}
