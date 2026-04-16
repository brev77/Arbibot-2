import { randomUUID } from 'node:crypto';

import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';

import {
  CAPITAL_RESERVED_PAYLOAD_SCHEMA_VERSION,
  EVENT_NAMES,
  SERVICE_IDS,
  type CapitalReservedPayloadV1,
} from '@arbibot/contracts';
import { AuditClientService, type IAuditClient } from '@arbibot/nest-platform';
import {
  CapitalReservationEntity,
  OutboxEventEntity,
  materializeCapitalReservationExpiryIfNeeded,
} from '@arbibot/persistence';

import type { ReserveCapitalDto } from './dto/reserve-capital.dto';

@Injectable()
export class CapitalService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(CapitalReservationEntity)
    private readonly repo: Repository<CapitalReservationEntity>,
    @Inject(AuditClientService) private readonly audit: IAuditClient,
  ) {}

  async reserve(dto: ReserveCapitalDto): Promise<CapitalReservationEntity> {
    const saved = await this.dataSource.transaction(async (em) => {
      const ttl = dto.ttlSeconds ?? 300;
      const expiresAt = new Date(Date.now() + ttl * 1000);
      const row = em.create(CapitalReservationEntity, {
        correlationId: dto.correlationId,
        planId: dto.planId ?? null,
        amountUsd: String(dto.amountUsd),
        state: 'active',
        expiresAt,
        entityVersion: 1,
      });
      const reservation = await em.save(CapitalReservationEntity, row);
      const messageId = randomUUID();
      const createdAt = new Date();
      const payload: CapitalReservedPayloadV1 = {
        reservationId: reservation.id,
        correlationId: reservation.correlationId,
        planId: reservation.planId,
        amountUsd: dto.amountUsd,
        expiresAt: reservation.expiresAt.toISOString(),
        entityVersion: reservation.entityVersion,
      };
      const envelope = {
        messageId,
        correlationId: dto.correlationId,
        entityType: 'CapitalReservation',
        entityId: reservation.id,
        version: CAPITAL_RESERVED_PAYLOAD_SCHEMA_VERSION,
        sourceModule: SERVICE_IDS.capitalService,
        eventTs: createdAt.toISOString(),
        eventName: EVENT_NAMES.capitalReserved,
        payload,
      };
      const outbox = em.create(OutboxEventEntity, {
        messageId,
        eventType: EVENT_NAMES.capitalReserved,
        entityType: 'CapitalReservation',
        entityId: reservation.id,
        schemaVersion: CAPITAL_RESERVED_PAYLOAD_SCHEMA_VERSION,
        payload: payload as unknown as Record<string, unknown>,
        envelope: envelope as unknown as Record<string, unknown>,
        processedAt: null,
      });
      await em.save(OutboxEventEntity, outbox);
      return reservation;
    });

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

  /**
   * Operator / orchestrator path: release an active reservation (single-writer: capital-service).
   * Idempotent: repeated release returns the same released row.
   */
  async release(id: string): Promise<CapitalReservationEntity> {
    let didTransition = false;
    const saved = await this.dataSource.transaction(async (em) => {
      const row = await em.findOne(CapitalReservationEntity, {
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });
      if (row === null) {
        throw new NotFoundException(`Reservation not found: ${id}`);
      }
      if (row.state === 'released') {
        return row;
      }
      if (row.state !== 'active') {
        throw new ConflictException(
          `Reservation ${id} cannot be released from state ${row.state}`,
        );
      }
      const now = new Date();
      if (materializeCapitalReservationExpiryIfNeeded(row, now)) {
        await em.save(CapitalReservationEntity, row);
        throw new ConflictException(
          `Reservation ${id} has expired and cannot be released`,
        );
      }
      row.state = 'released';
      row.entityVersion += 1;
      didTransition = true;
      return em.save(CapitalReservationEntity, row);
    });

    if (didTransition) {
      this.audit.record({
        idempotencyKey: `capital:ReleaseReservation:${saved.id}`,
        correlationId: saved.correlationId,
        actor: 'capital-service',
        action: 'ReleaseReservation',
        resourceType: 'CapitalReservation',
        resourceId: saved.id,
        payload: { state: saved.state },
      });
    }
    return saved;
  }
}
