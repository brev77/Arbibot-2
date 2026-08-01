import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  Between,
  EntityManager,
  LessThanOrEqual,
  MoreThanOrEqual,
  QueryFailedError,
  Repository,
  type FindOperator,
} from 'typeorm';

import { PaperTradeEntity, type PaperTradeState } from '@arbibot/persistence';
import { AuditClientService, type AuditRecordInput } from '@arbibot/nest-platform';

import type { CreatePaperTradeDto } from './dto/create-paper-trade.dto';
import type { PatchPaperTradeDto } from './dto/patch-paper-trade.dto';
import type { SettlePaperTradeDto } from './dto/settle-paper-trade.dto';
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

/** Clamp the history endpoint row limit to a safe range. (PAD-6) */
function clampHistoryLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) {
    return 100;
  }
  return Math.max(1, Math.min(500, Math.floor(limit)));
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

  /**
   * Settled paper trades in [from, to], newest first. Used by the operator history view.
   * `from`/`to` optional ISO strings; `limit` clamped to [1, 500], default 100. (PAD-6)
   */
  async history(opts: { from?: Date; to?: Date; limit?: number }): Promise<PaperTradeEntity[]> {
    const limit = clampHistoryLimit(opts.limit);
    const where: { state: 'settled'; settledAt?: FindOperator<Date> } = { state: 'settled' };
    if (opts.from !== undefined && opts.to !== undefined) {
      where.settledAt = Between(opts.from, opts.to);
    } else if (opts.from !== undefined) {
      where.settledAt = MoreThanOrEqual(opts.from);
    } else if (opts.to !== undefined) {
      where.settledAt = LessThanOrEqual(opts.to);
    }
    return this.repo.find({
      where,
      order: { settledAt: 'DESC' as const },
      take: limit,
    });
  }

  /**
   * Aggregate stats over settled trades in [from, to]: counts, win rate, P&L, avg spread.
   * Spread is read from the `summary->>'spreadBps'` jsonb field (written by settle()). (PAD-6)
   */
  async stats(opts: { from?: Date; to?: Date }): Promise<{
    total: string;
    wins: string;
    losses: string;
    winRate: string;
    totalProfitUsd: string;
    avgProfitUsd: string;
    avgSpreadBps: string | null;
  }> {
    // Raw SQL — aggregates over settled rows. profit_usd is NUMERIC(24,8); return as string
    // to preserve precision (consistent with how notional is exposed as string in this service).
    const params: (Date | string)[] = [];
    const conditions = ["state = 'settled'"];
    if (opts.from !== undefined) {
      params.push(opts.from);
      conditions.push(`settled_at >= $${params.length}`);
    }
    if (opts.to !== undefined) {
      params.push(opts.to);
      conditions.push(`settled_at <= $${params.length}`);
    }
    const where = conditions.join(' AND ');
    const sql = `
      SELECT
        COUNT(*)::text                                                        AS total,
        COUNT(*) FILTER (WHERE profit_usd > 0)::text                          AS wins,
        COUNT(*) FILTER (WHERE profit_usd <= 0)::text                         AS losses,
        COALESCE(AVG(profit_usd), 0)::text                                    AS avg_profit_usd,
        COALESCE(SUM(profit_usd), 0)::text                                    AS total_profit_usd,
        COALESCE(AVG(NULLIF((summary->>'spreadBps')::numeric, NULL)), NULL)::text AS avg_spread_bps
      FROM paper_trades
      WHERE ${where}
    `;
    const raw = await this.repo.query(sql, params);
    const row = (Array.isArray(raw) ? raw[0] : raw) as Record<string, string | null>;
    const totalNum = Number(row.total ?? '0');
    const winsNum = Number(row.wins ?? '0');
    return {
      total: row.total ?? '0',
      wins: row.wins ?? '0',
      losses: row.losses ?? '0',
      winRate: totalNum > 0 ? String(winsNum / totalNum) : '0',
      totalProfitUsd: row.total_profit_usd ?? '0',
      avgProfitUsd: row.avg_profit_usd ?? '0',
      avgSpreadBps: row.avg_spread_bps ?? null,
    };
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

    // Reserve capital AND transition draft → active in one transaction, so the
    // two writes commit or roll back together. Previously reserveCapital ran in
    // its own transaction before patch(): if the version-CAS patch then failed,
    // an orphaned `active` reservation was left behind with no trade to settle
    // it — and with no TTL worker wired up it blocked the instrument forever.
    let after: PaperTradeEntity;
    try {
      after = await this.repo.manager.transaction(async (em) => {
        return this.transitionToActive(em, id, before.entityVersion, before);
      });
    } catch (err) {
      // A concurrent approve() of another trade with the same instrument hits
      // the partial unique index `WHERE state='active'` (migration 050) at
      // commit. Surface it as a typed 409 instead of an opaque 500 — both the
      // HTTP caller and AutoDriveWorker's duplicate-instrument branch rely on a
      // recognizable signal here. `isUniqueViolation` keeps the message stable
      // for the worker's string-match fallback (`auto-drive.worker.ts` Phase B).
      if (isUniqueViolation(err)) {
        throw new ConflictException(
          `duplicate key: active reservation already exists for instrument ${before.instrumentKey}`,
        );
      }
      throw err;
    }

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

  /**
   * Shared core of approve(): within the caller's transaction, re-read the trade
   * with a pessimistic write lock, run the version CAS + state-machine guard,
   * reserve capital against this trade id, then transition to active. Exported
   * as a private method so the reserve and the state change are provably in the
   * same transaction (atomicity invariant).
   */
  private async transitionToActive(
    em: EntityManager,
    id: string,
    expectedVersion: number,
    before: PaperTradeEntity,
  ): Promise<PaperTradeEntity> {
    const row = await em.findOne(PaperTradeEntity, {
      where: { id },
      lock: { mode: 'pessimistic_write' },
    });
    if (row === null) {
      throw new NotFoundException(`Paper trade not found: ${id}`);
    }
    if (row.entityVersion !== expectedVersion) {
      throw new ConflictException(
        `Version mismatch: expected ${expectedVersion}, got ${row.entityVersion}`,
      );
    }
    assertTradeStateTransition(row.state, 'active');
    await this.paperCapitalService.reserveCapital(em, id, before.instrumentKey, before.notional);
    row.state = 'active';
    row.entityVersion += 1;
    return em.save(PaperTradeEntity, row);
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

    // Expire the reservation AND transition active → canceled in one
    // transaction: if the version-CAS state change fails, the reservation is
    // rolled back too (no orphaned `expired` row while the trade stays active).
    const after = await this.repo.manager.transaction(async (em) => {
      const row = await em.findOne(PaperTradeEntity, {
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });
      if (row === null) {
        throw new NotFoundException(`Paper trade not found: ${id}`);
      }
      if (row.entityVersion !== before.entityVersion) {
        throw new ConflictException(
          `Version mismatch: expected ${before.entityVersion}, got ${row.entityVersion}`,
        );
      }
      assertTradeStateTransition(row.state, 'canceled');
      // Expire the active reservation bound to THIS trade (looked up by tradeId).
      const activeReservation = await this.paperCapitalService.getActiveReservation(em, id);
      if (activeReservation !== null) {
        await this.paperCapitalService.expireReservation(em, activeReservation.id);
      }
      row.state = 'canceled';
      row.entityVersion += 1;
      return em.save(PaperTradeEntity, row);
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

  /**
   * Settle an active paper trade: record P/L (entry/exit/profit) and transition active → settled.
   * Releases the virtual capital reservation (same shape as `cancel`). Idempotent — if the trade
   * is already settled, returns the existing row unchanged so a duplicate AutoDriveWorker tick
   * does not double-count P/L or fail. (PAD-2)
   */
  async settle(
    id: string,
    dto: SettlePaperTradeDto,
    operatorId: string,
  ): Promise<PaperTradeEntity> {
    const before = await this.repo.findOne({ where: { id } });
    if (before === null) {
      throw new NotFoundException(`Paper trade not found: ${id}`);
    }
    // Idempotent: a second settle call returns the already-settled row instead of throwing.
    if (before.state === 'settled') {
      return before;
    }
    if (before.state !== 'active') {
      throw new BadRequestException(`Cannot settle paper trade in state ${before.state}`);
    }

    // Expire the reservation AND transition active → settled in one transaction
    // with the same pessimistic_write + entityVersion CAS pattern as patch().
    // If the version-CAS state change fails, the reservation expiry rolls back
    // too — symmetric with cancel(). P/L is settle-specific, so it does NOT go
    // through the generic patch() (which would otherwise let PATCH
    // /paper/trades/:id overwrite P/L arbitrarily).
    const after = await this.repo.manager.transaction(async (em) => {
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
      assertTradeStateTransition(row.state, 'settled');
      // Expire the active reservation bound to THIS trade (looked up by tradeId).
      const activeReservation = await this.paperCapitalService.getActiveReservation(em, id);
      if (activeReservation !== null) {
        await this.paperCapitalService.expireReservation(em, activeReservation.id);
      }
      row.state = 'settled';
      row.entryPrice = String(dto.entryPrice);
      row.exitPrice = String(dto.exitPrice);
      row.profitUsd = String(dto.profitUsd);
      row.settledAt = new Date();
      // Record spread into summary for /stats aggregation (avoids a join to promotion candidates).
      if (dto.spreadBps !== undefined) {
        row.summary = { ...row.summary, spreadBps: dto.spreadBps };
      }
      row.entityVersion += 1;
      return em.save(PaperTradeEntity, row);
    });

    const auditInput: AuditRecordInput = {
      actor: operatorId,
      action: 'paper_trade_settled',
      resourceType: 'PaperTrade',
      resourceId: id,
      payload: {
        instrumentKey: before.instrumentKey,
        notional: before.notional,
        fromState: before.state,
        toState: after.state,
        entryPrice: dto.entryPrice,
        exitPrice: dto.exitPrice,
        profitUsd: dto.profitUsd,
        ...(dto.spreadBps !== undefined ? { spreadBps: dto.spreadBps } : {}),
      },
    };
    void this.auditClient.appendEntry(auditInput).catch((err) => {
      console.error(`Failed to record audit for paper trade settle: ${err}`);
    });

    return after;
  }
}
