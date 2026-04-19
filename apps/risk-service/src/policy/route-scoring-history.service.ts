import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { RouteScoringHistoryEntity } from '@arbibot/persistence';

export type RouteScoringRowDto = {
  readonly id: string;
  readonly routeKey: string;
  readonly score: number;
  readonly modelVersion: string;
  readonly recordedAtIso: string;
};

/**
 * Versioned route scoring history (PRIO-P2-SCORE) for model quality tracking.
 */
@Injectable()
export class RouteScoringHistoryService {
  constructor(
    @InjectRepository(RouteScoringHistoryEntity)
    private readonly repo: Repository<RouteScoringHistoryEntity>,
  ) {}

  async listForRoute(
    routeKey: string,
    take: number,
  ): Promise<{ readonly items: RouteScoringRowDto[] }> {
    const rk = routeKey.trim();
    if (rk.length === 0) {
      throw new BadRequestException('routeKey is required');
    }
    const rows = await this.repo.find({
      where: { routeKey: rk },
      order: { recordedAt: 'DESC' },
      take,
    });
    return {
      items: rows.map((r) => ({
        id: r.id,
        routeKey: r.routeKey,
        score: Number(r.score),
        modelVersion: r.modelVersion,
        recordedAtIso: r.recordedAt.toISOString(),
      })),
    };
  }

  async append(
    routeKey: string,
    score: number,
    modelVersion: string,
  ): Promise<RouteScoringHistoryEntity> {
    const row = this.repo.create({
      routeKey: routeKey.trim(),
      score: String(score),
      modelVersion,
    });
    return this.repo.save(row);
  }
}
