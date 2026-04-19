import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

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
   * Reserve virtual capital for a paper trade.
   * Creates an active reservation with TTL.
   */
  async reserveCapital(instrumentKey: string, notional: string): Promise<PaperCapitalReservationEntity> {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + this.DEFAULT_TTL_MS);

    const reservation = this.repo.create({
      instrumentKey,
      notional,
      state: 'active',
      expiresAt,
      entityVersion: 1,
    });

    return this.repo.save(reservation);
  }

  /**
   * Get active reservation for an instrument.
   * Returns null if no active reservation exists.
   */
  async getActiveReservation(instrumentKey: string): Promise<PaperCapitalReservationEntity | null> {
    return this.repo.findOne({
      where: {
        instrumentKey,
        state: 'active' as PaperCapitalReservationState,
      },
      order: { createdAt: 'DESC' },
    });
  }

  /**
   * Mark reservation as expired.
   */
  async expireReservation(id: string): Promise<PaperCapitalReservationEntity | null> {
    const reservation = await this.repo.findOne({
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
    return this.repo.save(reservation);
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
