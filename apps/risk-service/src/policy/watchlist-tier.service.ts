import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { WatchlistTierSnapshotEntity } from '@arbibot/persistence';

export type WatchlistTierRowDto = {
  readonly id: string;
  readonly instrumentKey: string;
  readonly tier: string;
  readonly reason: string;
  readonly recordedAtIso: string;
};

/**
 * Operator watchlist tier snapshots (PRIO-P2-TIER) — append-only audit trail.
 */
@Injectable()
export class WatchlistTierService {
  constructor(
    @InjectRepository(WatchlistTierSnapshotEntity)
    private readonly repo: Repository<WatchlistTierSnapshotEntity>,
  ) {}

  /**
   * Latest snapshot per instrument (PostgreSQL DISTINCT ON), ordered by instrument key.
   */
  async listRecent(take: number): Promise<{ readonly items: WatchlistTierRowDto[] }> {
    const rows = await this.repo
      .createQueryBuilder('w')
      .distinctOn(['w.instrumentKey'])
      .orderBy('w.instrumentKey', 'ASC')
      .addOrderBy('w.recordedAt', 'DESC')
      .take(Math.min(500, Math.max(1, take)))
      .getMany();
    return {
      items: rows.map((r) => ({
        id: r.id,
        instrumentKey: r.instrumentKey,
        tier: r.tier,
        reason: r.reason,
        recordedAtIso: r.recordedAt.toISOString(),
      })),
    };
  }

  async findLatestForInstrument(
    instrumentKey: string,
  ): Promise<WatchlistTierSnapshotEntity | null> {
    return this.repo.findOne({
      where: { instrumentKey },
      order: { recordedAt: 'DESC' },
    });
  }

  async recordSnapshot(
    instrumentKey: string,
    tier: string,
    reason: string,
  ): Promise<WatchlistTierSnapshotEntity> {
    const row = this.repo.create({
      instrumentKey,
      tier,
      reason,
    });
    return this.repo.save(row);
  }
}
