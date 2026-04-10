import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';

import { AuditClientService } from '@arbibot/nest-platform';
import {
  CapitalReservationEntity,
  materializeCapitalReservationExpiryIfNeeded,
} from '@arbibot/persistence';

import type { ReserveCapitalDto } from './dto/reserve-capital.dto';

@Injectable()
export class CapitalService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(CapitalReservationEntity)
    private readonly repo: Repository<CapitalReservationEntity>,
    private readonly audit: AuditClientService,
  ) {}

  async reserve(dto: ReserveCapitalDto): Promise<CapitalReservationEntity> {
    const ttl = dto.ttlSeconds ?? 300;
    const expiresAt = new Date(Date.now() + ttl * 1000);
    const row = this.repo.create({
      correlationId: dto.correlationId,
      planId: dto.planId ?? null,
      amountUsd: String(dto.amountUsd),
      state: 'active',
      expiresAt,
      entityVersion: 1,
    });
    const saved = await this.repo.save(row);
    this.audit.record({
      idempotencyKey: `capital:ReserveCapital:${saved.id}`,
      correlationId: dto.correlationId,
      actor: 'capital-service',
      action: 'ReserveCapital',
      resourceType: 'CapitalReservation',
      resourceId: saved.id,
      payload: {
        planId: saved.planId,
        amountUsd: dto.amountUsd,
        expiresAtIso: saved.expiresAt.toISOString(),
      },
    });
    return saved;
  }

  async getById(id: string): Promise<CapitalReservationEntity> {
    return this.dataSource.transaction(async (em) => {
      const row = await em.findOne(CapitalReservationEntity, {
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });
      if (row === null) {
        throw new NotFoundException(`Reservation not found: ${id}`);
      }
      const now = new Date();
      if (materializeCapitalReservationExpiryIfNeeded(row, now)) {
        await em.save(CapitalReservationEntity, row);
      }
      return row;
    });
  }
}
