import { ConflictException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, QueryFailedError, Repository } from 'typeorm';

import { AuditLogEntity } from '@arbibot/persistence';

import type { AppendAuditDto } from './dto/append-audit.dto';

function isPgUniqueViolation(error: unknown): boolean {
  return (
    error instanceof QueryFailedError &&
    typeof error.driverError === 'object' &&
    error.driverError !== null &&
    (error.driverError as { code?: string }).code === '23505'
  );
}

export interface AppendAuditResult {
  readonly replay: boolean;
  readonly entity: AuditLogEntity;
}

@Injectable()
export class AuditService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(AuditLogEntity)
    private readonly repo: Repository<AuditLogEntity>,
  ) {}

  async append(dto: AppendAuditDto): Promise<AppendAuditResult> {
    if (dto.idempotencyKey === undefined) {
      const entity = await this.repo.save(
        this.repo.create({
          correlationId: dto.correlationId ?? null,
          actor: dto.actor,
          action: dto.action,
          resourceType: dto.resourceType ?? null,
          resourceId: dto.resourceId ?? null,
          payload: dto.payload ?? null,
          idempotencyKey: null,
        }),
      );
      return { replay: false, entity };
    }

    return this.dataSource.transaction(async (em) => {
      const existing = await em.findOne(AuditLogEntity, {
        where: { idempotencyKey: dto.idempotencyKey },
        lock: { mode: 'pessimistic_write' },
      });
      if (existing !== null) {
        this.assertSameAuditPayload(existing, dto);
        return { replay: true, entity: existing };
      }

      const row = em.create(AuditLogEntity, {
        correlationId: dto.correlationId ?? null,
        actor: dto.actor,
        action: dto.action,
        resourceType: dto.resourceType ?? null,
        resourceId: dto.resourceId ?? null,
        payload: dto.payload ?? null,
        idempotencyKey: dto.idempotencyKey,
      });

      try {
        await em.save(AuditLogEntity, row);
        return { replay: false, entity: row };
      } catch (e) {
        if (!isPgUniqueViolation(e)) {
          throw e;
        }
        const again = await em.findOne(AuditLogEntity, {
          where: { idempotencyKey: dto.idempotencyKey },
        });
        if (again === null) {
          throw e;
        }
        this.assertSameAuditPayload(again, dto);
        return { replay: true, entity: again };
      }
    });
  }

  async recent(limit: number): Promise<AuditLogEntity[]> {
    return this.repo.find({
      order: { createdAt: 'DESC' },
      take: Math.min(Math.max(limit, 1), 500),
    });
  }

  private assertSameAuditPayload(row: AuditLogEntity, dto: AppendAuditDto): void {
    const payloadEqual =
      JSON.stringify(row.payload ?? null) === JSON.stringify(dto.payload ?? null);
    const same =
      row.actor === dto.actor &&
      row.action === dto.action &&
      (row.correlationId ?? undefined) === (dto.correlationId ?? undefined) &&
      (row.resourceType ?? undefined) === (dto.resourceType ?? undefined) &&
      (row.resourceId ?? undefined) === (dto.resourceId ?? undefined) &&
      payloadEqual;
    if (!same) {
      throw new ConflictException(
        `Audit idempotency key ${dto.idempotencyKey} conflicts with prior entry`,
      );
    }
  }
}
