import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { TokenProfileEntity } from '@arbibot/persistence';

export type TokenProfileRowDto = {
  readonly instrumentKey: string;
  readonly maxNotionalUsd: number;
  readonly entityVersion: number;
};

/**
 * Read-only token profile caps (Phase 2.2 / P2-2.2-PROF).
 * Single-writer for mutations remains future scope; list API is read-mostly.
 */
@Injectable()
export class TokenProfileService {
  constructor(
    @InjectRepository(TokenProfileEntity)
    private readonly tokens: Repository<TokenProfileEntity>,
  ) {}

  async list(): Promise<{ readonly items: TokenProfileRowDto[] }> {
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
}
