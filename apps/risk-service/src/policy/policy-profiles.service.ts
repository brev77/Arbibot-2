import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { RouteProfileEntity, TokenProfileEntity } from '@arbibot/persistence';

export type TokenProfileRowDto = {
  readonly instrumentKey: string;
  readonly maxNotionalUsd: number;
  readonly entityVersion: number;
};

export type RouteProfileRowDto = {
  readonly routeKey: string;
  readonly maxNotionalUsd: number;
  readonly entityVersion: number;
};

@Injectable()
export class PolicyProfilesService {
  constructor(
    @InjectRepository(TokenProfileEntity)
    private readonly tokens: Repository<TokenProfileEntity>,
    @InjectRepository(RouteProfileEntity)
    private readonly routes: Repository<RouteProfileEntity>,
  ) {}

  async listTokenProfiles(): Promise<{ readonly items: TokenProfileRowDto[] }> {
    const rows = await this.tokens.find({
      order: { instrumentKey: 'ASC' },
      take: 500,
    });
    return {
      items: rows.map((r) => ({
        instrumentKey: r.instrumentKey,
        maxNotionalUsd: Number(r.maxNotionalUsd),
        entityVersion: r.entityVersion,
      })),
    };
  }

  async listRouteProfiles(): Promise<{ readonly items: RouteProfileRowDto[] }> {
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
