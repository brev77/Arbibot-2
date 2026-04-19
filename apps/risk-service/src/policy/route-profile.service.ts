import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { RouteProfileEntity } from '@arbibot/persistence';

export type RouteProfileRowDto = {
  readonly routeKey: string;
  readonly maxNotionalUsd: number;
  readonly entityVersion: number;
};

/**
 * Read-only route profile caps (Phase 2.2 / P2-2.2-PROF).
 */
@Injectable()
export class RouteProfileService {
  constructor(
    @InjectRepository(RouteProfileEntity)
    private readonly routes: Repository<RouteProfileEntity>,
  ) {}

  async list(): Promise<{ readonly items: RouteProfileRowDto[] }> {
    const rows = await this.routes.find({
      order: { routeKey: 'ASC' },
      take: 500,
    });
    return {
      items: rows.map((r) => ({
        routeKey: r.routeKey,
        maxNotionalUsd: Number(r.maxNotionalUsd),
        entityVersion: r.entityVersion,
      })),
    };
  }
}
