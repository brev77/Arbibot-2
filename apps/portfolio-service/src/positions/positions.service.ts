import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';

import {
  PortfolioPositionEntity,
  PortfolioPositionFillIdempotencyEntity,
} from '@arbibot/persistence';

import type { ConfirmFillDto } from './dto/confirm-fill.dto';
import { addNonNegativeDecimalStrings } from './add-decimal-string';

@Injectable()
export class PositionsService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(PortfolioPositionEntity)
    private readonly repo: Repository<PortfolioPositionEntity>,
  ) {}

  async list(): Promise<PortfolioPositionEntity[]> {
    return this.repo.find({
      order: { updatedAt: 'DESC' },
      take: 200,
    });
  }

  async confirmFill(dto: ConfirmFillDto): Promise<void> {
    await this.dataSource.transaction(async (em) => {
      const dedupe = await em.findOne(PortfolioPositionFillIdempotencyEntity, {
        where: { legId: dto.legId, idempotencyKey: dto.idempotencyKey },
      });
      if (dedupe !== null) {
        return;
      }

      let pos = await em.findOne(PortfolioPositionEntity, {
        where: { planId: dto.planId, instrumentKey: dto.instrumentKey },
        lock: { mode: 'pessimistic_write' },
      });
      if (pos === null) {
        pos = em.create(PortfolioPositionEntity, {
          planId: dto.planId,
          instrumentKey: dto.instrumentKey,
          quantity: '0',
          entityVersion: 1,
        });
        await em.save(pos);
      }

      pos.quantity = addNonNegativeDecimalStrings(pos.quantity, dto.quantity);
      pos.entityVersion += 1;
      await em.save(pos);

      await em.insert(PortfolioPositionFillIdempotencyEntity, {
        legId: dto.legId,
        idempotencyKey: dto.idempotencyKey,
      });
    });
  }
}
