/**
 * Domain errors for `alertmanager_incidents` operator transitions (Drill #1 gap #5).
 *
 * Mirrors the optimistic-concurrency + not-found pattern used by
 * `reconciliation-mismatches` (`apps/reconciliation-service/src/reconciliation`).
 */
import { ConflictException, NotFoundException } from '@nestjs/common';

/**
 * Thrown by `AlertIncidentsService.setStatus()` when no row matches `id`.
 *
 * HTTP 404 — surfaced to the operator as "Incident no longer exists".
 */
export class AlertIncidentNotFoundError extends NotFoundException {
  readonly incidentId: string;

  constructor(id: string) {
    super(`Alert incident ${id} not found`);
    this.name = 'AlertIncidentNotFoundError';
    this.incidentId = id;
  }
}

/**
 * Thrown by `AlertIncidentsService.setStatus()` when the persisted
 * `entityVersion` does not match the caller's `expectedEntityVersion`.
 *
 * Indicates a stale read — another operator/webhook updated the incident
 * between the GET and PATCH. The UI must refetch and retry.
 *
 * Extends `ConflictException` so NestJS surfaces it as HTTP 409 without
 * needing a global exception filter.
 */
export class AlertIncidentVersionMismatchError extends ConflictException {
  readonly incidentId: string;
  readonly expectedVersion: number;
  readonly actualVersion: number;

  constructor(id: string, expectedVersion: number, actualVersion: number) {
    super({
      message: `Alert incident ${id} version mismatch: expected ${expectedVersion}, actual ${actualVersion}`,
      incidentId: id,
      expectedVersion,
      actualVersion,
    });
    this.name = 'AlertIncidentVersionMismatchError';
    this.incidentId = id;
    this.expectedVersion = expectedVersion;
    this.actualVersion = actualVersion;
  }
}