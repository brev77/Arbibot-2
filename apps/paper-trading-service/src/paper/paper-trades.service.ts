import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryFailedError, Repository } from 'typeorm';

import { PaperTradeEntity, type PaperTradeState } from '@arbibot/persistence';
import { AuditClientService, type AuditRecordInput } from '@arbibot/nest-platform';

import type { CreatePaperTradeDto } from './dto/create-paper-trade.dto';
import type { PatchPaperTradeDto } from './dto/patch-paper-trade.dto';
import { PaperCapitalService } from './paper-capital.service';

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
    private readonly auditClient: AuditClientService,
    private readonly paperCapitalService: PaperCapitalService,
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

  async approve(id: string, operatorId: string): Promise<PaperTradeEntity> {
    const before = await this.repo.findOne({ where: { id } });
    if (before === null) {
      throw new NotFoundException(`Paper trade not found: ${id}`);
    }
    if (before.state !== 'draft') {
      throw new BadRequestException(`Cannot approve paper trade in state ${before.state}`);
    }

    // Create virtual capital reservation before transitioning to active
    await this.paperCapitalService.reserveCapital(before.instrumentKey, before.notional);

    const after = await this.patch(id, {
      expectedVersion: before.entityVersion,
      state: 'active',
    });

    const auditInput: AuditRecordInput = {
      actor: operatorId,
      action: 'paper_trade_approved',
      resourceType: 'PaperTrade',
      resourceId: id,
      payload: {
        instrumentKey: before.instrumentKey,
        notional: before.notional,
        fromState: before.state,
        toState: after.state,
      },
    };
    void this.auditClient.appendEntry(auditInput).catch((err) => {
      console.error(`Failed to record audit for paper trade approve: ${err}`);
    });

    return after;
  }

  async reject(id: string, operatorId: string): Promise<PaperTradeEntity> {
    const before = await this.repo.findOne({ where: { id } });
    if (before === null) {
      throw new NotFoundException(`Paper trade not found: ${id}`);
    }
    if (before.state !== 'draft') {
      throw new BadRequestException(`Cannot reject paper trade in state ${before.state}`);
    }

    const after = await this.patch(id, {
      expectedVersion: before.entityVersion,
      state: 'canceled',
    });

    const auditInput: AuditRecordInput = {
      actor: operatorId,
      action: 'paper_trade_rejected',
      resourceType: 'PaperTrade',
      resourceId: id,
      payload: {
        instrumentKey: before.instrumentKey,
        notional: before.notional,
        fromState: before.state,
        toState: after.state,
      },
    };
    void this.auditClient.appendEntry(auditInput).catch((err) => {
      console.error(`Failed to record audit for paper trade reject: ${err}`);
    });

    return after;
  }

  async cancel(id: string, operatorId: string): Promise<PaperTradeEntity> {
    const before = await this.repo.findOne({ where: { id } });
    if (before === null) {
      throw new NotFoundException(`Paper trade not found: ${id}`);
    }
    if (before.state !== 'active') {
      throw new BadRequestException(`Cannot cancel paper trade in state ${before.state}`);
    }

    // Expire virtual capital reservation when canceling active trade
    const activeReservation = await this.paperCapitalService.getActiveReservation(before.instrumentKey);
    if (activeReservation !== null) {
      await this.paperCapitalService.expireReservation(activeReservation.id);
    }

    const after = await this.patch(id, {
      expectedVersion: before.entityVersion,
      state: 'canceled',
    });

    const auditInput: AuditRecordInput = {
      actor: operatorId,
      action: 'paper_trade_canceled',
      resourceType: 'PaperTrade',
      resourceId: id,
      payload: {
        instrumentKey: before.instrumentKey,
        notional: before.notional,
        fromState: before.state,
        toState: after.state,
      },
    };
    void this.auditClient.appendEntry(auditInput).catch((err) => {
      console.error(`Failed to record audit for paper trade cancel: ${err}`);
    });

    return after;
  }
}
