import { randomUUID } from 'node:crypto';

import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, QueryFailedError, Repository } from 'typeorm';
import { Gauge } from 'prom-client';
import { getArbibotMetricsRegistry } from '@arbibot/nest-platform';

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
import { CapitalLimitsService } from './capital-limits.service';

const METRIC_ACTIVE_USD = 'arb_capital_ceiling_active_usd';

/**
 * Reservation would push active capital (reservations + open positions) over
 * the configured ceiling. Maps to HTTP 422 (Unprocessable Entity). The leg
 * stays retryable: a caller may retry once active reservations expire / are
 * released, or after the ceiling is raised.
 */
export class CapitalCeilingExceededError extends UnprocessableEntityException {
  constructor(
    public readonly ceilingUsd: number,
    public readonly activeUsd: number,
    public readonly requestedUsd: number,
  ) {
    super({
      message: `Capital ceiling exceeded: active $${activeUsd} + requested $${requestedUsd} > ceiling $${ceilingUsd}`,
      ceilingUsd,
      activeUsd,
      requestedUsd,
    });
  }
}

@Injectable()
export class CapitalService {
  private readonly logger = new Logger(CapitalService.name);
  private readonly activeUsdGauge: Gauge<string>;

  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(CapitalReservationEntity)
    private readonly repo: Repository<CapitalReservationEntity>,
    @Inject(AuditClientService) private readonly audit: IAuditClient,
    private readonly limits: CapitalLimitsService,
  ) {
    this.activeUsdGauge = this.initializeMetric();
  }

  async reserve(dto: ReserveCapitalDto): Promise<CapitalReservationEntity> {
    // P9-9 (live-readiness): idempotency on `correlationId`. A retried
    // `POST /capital/reservations` (timeout / retry middleware) would otherwise
    // create a SECOND active reservation — doubling the consumed ceiling or
    // allowing a plan to execute on twice the capital. Migration 051 added a
    // partial unique index `uniq_capital_res_active_per_correlation` on
    // `(correlation_id) WHERE state = 'active'`. When a concurrent/retried
    // reserve() collides on the same correlation_id, PG raises unique-violation
    // (code 23505) at commit; we catch it and return the existing active row,
    // making the endpoint idempotent within the ACTIVE window. Expired/released
    // rows are unconstrained, so a correlation_id may be reused later.
    try {
      return await this.attemptReserve(dto);
    } catch (err) {
      if (isPgUniqueViolationForCorrelation(err)) {
        this.logger.warn(
          `Duplicate capital reservation for correlationId ${dto.correlationId} — returning existing active reservation (idempotent retry, P9-9).`,
        );
        const existing = await this.repo.findOne({
          where: { correlationId: dto.correlationId, state: 'active' },
        });
        if (existing !== null) {
          return existing;
        }
        // Edge case: the row that caused the unique violation was concurrently
        // expired/released between commit and this lookup. Fall through and
        // retry the reserve once.
        return this.attemptReserve(dto);
      }
      throw err;
    }
  }

  private async attemptReserve(dto: ReserveCapitalDto): Promise<CapitalReservationEntity> {
    const saved = await this.dataSource.transaction(async (em) => {
      // D4-B-3-CEILING: aggregate capital gate. Fail-closed ceiling comes from
      // CapitalLimitsService (config-service + env lower-bound); may throw
      // (ServiceUnavailableException) in prod when unresolved — no reservation.
      const ceiling = await this.limits.getMaxActiveCapitalUsd();

      // SUM(active reservations) serializes concurrent reserve() calls and
      // closes the C1 race on the aggregate. PostgreSQL forbids FOR UPDATE on
      // an aggregate directly, so lock the underlying active rows in a subquery
      // and sum over them — a concurrent reserve() blocks on those row locks
      // until the first transaction commits, then re-reads the updated total.
      const reservationsRows: Array<{ sum: string }> = await em.query(
        `SELECT COALESCE(SUM(amount_usd), 0) AS sum FROM (SELECT amount_usd FROM capital_reservations WHERE state = 'active' FOR UPDATE) locked`,
      );
      // SUM(open positions' USD notional). Open = quantity <> 0 (close sets
      // quantity to 0). capital-service is a read-only consumer of
      // portfolio_positions (single-writer = portfolio-service).
      const positionsRows: Array<{ sum: string }> = await em.query(
        `SELECT COALESCE(SUM(notional_usd), 0) AS sum FROM portfolio_positions WHERE quantity <> 0`,
      );

      const activeReservationsUsd = Number(reservationsRows[0]?.sum ?? 0);
      const openPositionsUsd = Number(positionsRows[0]?.sum ?? 0);
      const activeTotal = activeReservationsUsd + openPositionsUsd;
      this.activeUsdGauge.set(activeTotal);

      if (activeTotal + dto.amountUsd > ceiling) {
        this.logger.warn(
          `Capital ceiling exceeded: active reservations $${activeReservationsUsd} + open positions $${openPositionsUsd} + requested $${dto.amountUsd} > ceiling $${ceiling}`,
        );
        throw new CapitalCeilingExceededError(ceiling, activeTotal, dto.amountUsd);
      }

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

  // ── Metrics ──────────────────────────────────────────────────────────

  private initializeMetric(): Gauge<string> {
    const registry = getArbibotMetricsRegistry();
    const existing = registry.getSingleMetric(METRIC_ACTIVE_USD);
    if (existing !== undefined) {
      return existing as Gauge<string>;
    }
    return new Gauge({
      name: METRIC_ACTIVE_USD,
      help: 'Active capital in USD (SUM active reservations + SUM open positions) at the last reserve() check (D4-B-3-CEILING)',
      registers: [registry],
    });
  }
}

/**
 * Detects a PostgreSQL unique-violation (SQLSTATE 23505) raised by the partial
 * unique index `uniq_capital_res_active_per_correlation` (migration 051) when a
 * concurrent/retried `reserve()` collides on the same `correlation_id` in the
 * ACTIVE window. Used by `reserve()` to fall back to the existing row instead
 * of throwing — making the HTTP endpoint idempotent on `correlationId`.
 */
function isPgUniqueViolationForCorrelation(err: unknown): boolean {
  if (!(err instanceof QueryFailedError)) {
    return false;
  }
  const code =
    typeof err.driverError === 'object' &&
    err.driverError !== null &&
    'code' in err.driverError
      ? String((err.driverError as { code?: string }).code)
      : '';
  // The constraint name appears in the driver error message; verify it is our
  // partial index so we don't swallow unrelated 23505 violations (e.g. a future
  // unique constraint on a different column).
  const message =
    typeof err.driverError === 'object' &&
    err.driverError !== null &&
    'message' in err.driverError
      ? String((err.driverError as { message?: string }).message)
      : '';
  return code === '23505' && message.includes('uniq_capital_res_active_per_correlation');
}
