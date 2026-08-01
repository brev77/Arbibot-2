import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, type Repository } from 'typeorm';

import {
  PaperCapitalReservationEntity,
  type PaperCapitalReservationState,
} from '@arbibot/persistence';

@Injectable()
export class PaperCapitalService {
  private readonly logger = new Logger(PaperCapitalService.name);
  private readonly DEFAULT_TTL_MS = 60 * 60 * 1000; // 60 minutes

  constructor(
    @InjectRepository(PaperCapitalReservationEntity)
    private readonly repo: Repository<PaperCapitalReservationEntity>,
  ) {}

  /**
   * Resolve a repository within the caller's transaction when provided, falling
   * back to the injected default repository otherwise. Keeping this optional
   * lets the same method run either standalone or inside an outer
   * `em.transaction(...)` — so `PaperTradesService` can reserve/expire a
   * reservation atomically with the trade state transition (the two writes
   * commit or roll back together).
   */
  private resolve(em: EntityManager | undefined): Repository<PaperCapitalReservationEntity> {
    return em === undefined ? this.repo : em.getRepository(PaperCapitalReservationEntity);
  }

  /**
   * Reserve virtual capital for a paper trade.
   *
   * Creates an `active` reservation bound to the trade via `tradeId` (the
   * `trade_id` FK + partial index from migration 021). The reservation is
   * looked up by `tradeId` later (see `getActiveReservation`) so it is tied to
   * one specific trade rather than to whatever `instrumentKey` happens to be
   * active at the moment. Pass `em` to participate in the caller's transaction.
   */
  async reserveCapital(
    em: EntityManager | undefined,
    tradeId: string,
    instrumentKey: string,
    notional: string,
  ): Promise<PaperCapitalReservationEntity> {
    const repo = this.resolve(em);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + this.DEFAULT_TTL_MS);

    const reservation = repo.create({
      instrumentKey,
      notional,
      state: 'active',
      expiresAt,
      entityVersion: 1,
      tradeId,
    });

    return repo.save(reservation);
  }

  /**
   * Get the active reservation for a specific trade. Returns null if no active
   * reservation exists for that trade. Pass `em` to read within the caller's
   * transaction (the reservation row is then locked by the caller's
   * `pessimistic_write` lock on the trade).
   */
  async getActiveReservation(
    em: EntityManager | undefined,
    tradeId: string,
  ): Promise<PaperCapitalReservationEntity | null> {
    return this.resolve(em).findOne({
      where: {
        tradeId,
        state: 'active' as PaperCapitalReservationState,
      },
      order: { createdAt: 'DESC' },
    });
  }

  /**
   * Mark reservation as expired, with a version CAS and a row lock so two
   * concurrent expirers cannot both flip the same row. Pass `em` to participate
   * in the caller's transaction — when settle()/cancel() move the trade to its
   * terminal state, the reservation expiry commits in the same transaction.
   */
  async expireReservation(
    em: EntityManager | undefined,
    id: string,
  ): Promise<PaperCapitalReservationEntity | null> {
    const repo = this.resolve(em);
    const reservation = await repo.findOne({
      where: { id },
      lock: { mode: 'pessimistic_write' },
    });

    if (reservation === null) {
      return null;
    }

    if (reservation.state !== 'active') {
      return reservation;
    }

    reservation.state = 'expired';
    reservation.entityVersion += 1;
    return repo.save(reservation);
  }

  /**
   * Background job to expire all reservations past their TTL.
   * Should be called periodically (e.g., every 5 minutes).
   */
  async expireReservations(): Promise<number> {
    const now = new Date();

    // Use raw SQL for better performance with bulk updates
    const result = await this.repo
      .createQueryBuilder()
      .update(PaperCapitalReservationEntity)
      .set({ state: 'expired', entityVersion: () => 'entity_version + 1', updatedAt: now })
      .where('state = :state', { state: 'active' })
      .andWhere('expires_at <= :now', { now })
      .execute();

    const expiredCount = result.affected || 0;
    if (expiredCount > 0) {
      this.logger.log(`Expired ${expiredCount} paper capital reservations`);
    }

    return expiredCount;
  }
}
