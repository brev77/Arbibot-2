import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';

import {
  PortfolioPositionEntity,
  PortfolioPositionFillIdempotencyEntity,
  PortfolioPositionCloseIdempotencyEntity,
} from '@arbibot/persistence';
import { AuditClientService } from '@arbibot/nest-platform';

import type { ClosePositionDto } from './dto/close-position.dto';
import type { ConfirmFillDto } from './dto/confirm-fill.dto';
import { addNonNegativeDecimalStrings } from './add-decimal-string';

function isZeroQuantity(q: string): boolean {
  const n = Number(q);
  return !Number.isFinite(n) || n === 0;
}

@Injectable()
export class PositionsService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(PortfolioPositionEntity)
    private readonly repo: Repository<PortfolioPositionEntity>,
    private readonly audit: AuditClientService,
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

  async close(positionId: string, dto: ClosePositionDto): Promise<PortfolioPositionEntity> {
    return this.dataSource.transaction(async (em) => {
      const idem = dto.idempotencyKey?.trim();
      if (idem !== undefined && idem.length > 0) {
        const existing = await em.findOne(PortfolioPositionCloseIdempotencyEntity, {
          where: { positionId, idempotencyKey: idem },
        });
        if (existing !== null) {
          const row = await em.findOne(PortfolioPositionEntity, {
            where: { id: positionId },
          });
          if (row === null) {
            throw new NotFoundException(`Position ${positionId} not found`);
          }
          return row;
        }
      }

      const pos = await em.findOne(PortfolioPositionEntity, {
        where: { id: positionId },
        lock: { mode: 'pessimistic_write' },
      });
      if (pos === null) {
        throw new NotFoundException(`Position ${positionId} not found`);
      }

      if (
        dto.expectedEntityVersion !== undefined &&
        pos.entityVersion !== dto.expectedEntityVersion
      ) {
        throw new ConflictException({
          message: 'entity version mismatch',
          expectedEntityVersion: dto.expectedEntityVersion,
          currentEntityVersion: pos.entityVersion,
        });
      }

      if (isZeroQuantity(pos.quantity)) {
        await this.audit.appendEntry({
          idempotencyKey: idem,
          actor: dto.operatorId,
          action: 'PORTFOLIO_POSITION_CLOSE_IDEMPOTENT',
          resourceType: 'portfolio_position',
          resourceId: positionId,
          payload: {
            approveReason: dto.approveReason ?? null,
            note: 'already_zero',
          },
        });
        return pos;
      }

      pos.quantity = '0';
      pos.entityVersion += 1;
      await em.save(pos);

      if (idem !== undefined && idem.length > 0) {
        await em.insert(PortfolioPositionCloseIdempotencyEntity, {
          positionId,
          idempotencyKey: idem,
        });
      }

      await this.audit.appendEntry({
        idempotencyKey: idem,
        actor: dto.operatorId,
        action: 'PORTFOLIO_POSITION_CLOSED',
        resourceType: 'portfolio_position',
        resourceId: positionId,
        payload: {
          approveReason: dto.approveReason ?? null,
          newEntityVersion: pos.entityVersion,
        },
      });

      return pos;
    });
  }
}
